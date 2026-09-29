// ─── Upload Article — สแกนเว็บปลายทางแบบละเอียดก่อน push ──────────────────────────
// 1) เว็บใช้ CMS / ธีม / page builder / ปลั๊กอินอะไร
// 2) ปลั๊กอิน/ธีม/template ใส่ สารบัญ / FAQ / CTA ให้ทุกบทความเองหรือไม่ (push ไปจะซ้อนกัน)
//    ตัดของเราออกเฉพาะกรณีปลั๊กอิน/template ใส่ให้เองเท่านั้น — ส่วนที่ผู้เขียนเขียนเองในเนื้อหาบทความเดิม
//    (เช่น CTA/FAQ ที่พิมพ์มาในบทความ) ไม่ติดมากับบทความใหม่ ระบบจึงยังใส่ของเรา
// 3) หน้าตา FAQ card + ตาราง + สีตัวอักษรในบทความของเว็บ (ให้บทความใหม่หน้าตาเข้าธีมเดียวกัน)
//    สีตัวอักษร/หัวข้อ/ลิงก์/พื้นหลังคำนวณจาก CSS จริงด้วย css-cascade (ไม่ให้ AI เดา) รวมถึงพื้นหลังโปร่งใส
// อ่านอย่างเดียว: GET หน้าเว็บสาธารณะ + WP REST สาธารณะ ผ่าน SSRF guard ของ competitor-gap
// บทความที่ Upload Article เคย push ไป (มี div.content-article) ถูกตัดออกจากการนับทุกจุด กันนับของตัวเอง

import { safeFetchHtml as fetchHtml, safeFetchText as fetchText } from './safe-fetch'
import { askJson } from '@/lib/competitor-gap/ai'
import type { ORUsage } from '@/lib/openrouter'
import { safeColor, sanitizeThemeDetail } from './theme-css'
import { contrast, CssCascade, luminance, mediaApplies, openChainAt, parseCssRules, parseOpenTag, toHex, type CssEl, type CssRule } from './css-cascade'
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
  /** false = เจอใน template ของหน้าบทความ (นอกเนื้อหา) แล้วไม่นับ เช่น ปุ่ม LINE/โทรที่เป็นไอคอนโซเชียลของเว็บ */
  templateOk?: boolean
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
    // details/summary เปล่าไม่มี class — บทความที่ฝัง CSS มาเองมักใช้แบบนี้ (weak: เมนู/ส่วนอื่นของธีมก็ใช้ details ได้)
    { re: /<details\b[^>]*>\s*<summary\b/i, label: 'FAQ แบบ details/summary ในเนื้อหา', element: true, weak: true },
    { re: /"@type"\s*:\s*"FAQPage"/i, label: 'FAQ schema (FAQPage)', weak: true },
    { re: /คำถามที่พบบ่อย|Frequently Asked Questions/i, label: 'หัวข้อ "คำถามที่พบบ่อย"', weak: true },
  ],
  cta: [
    { re: /elementor-widget-call-to-action/i, label: 'Elementor Call to Action widget' },
    // cta เป็นคำใน class เช่น cta, cta-box, cj-cta-box, btn_cta
    { re: /class="[^"]*(?<![a-z0-9])cta(?![a-z0-9])[^"]*"/i, label: 'กล่อง CTA (class มีคำว่า cta)' },
    { re: /class="[^"]*call-?to-?action/i, label: 'กล่อง call-to-action' },
    { re: /href="https?:\/\/(?:line\.me|lin\.ee)\//i, label: 'ปุ่ม LINE ในเนื้อบทความ', homeOk: false, templateOk: false },
    { re: /href="tel:/i, label: 'ปุ่มโทรในเนื้อบทความ', homeOk: false, templateOk: false },
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

/** class ของกล่องเนื้อหาที่ผู้เขียนเขียน เรียงตามความเจาะจง (Elementor single template → ธีมทั่วไป) */
const CONTENT_CLASSES = [
  'elementor-widget-theme-post-content',
  'entry-content',
  'post-content',
  'wp-block-post-content',
  'single-content',
  'article-content',
  'the-content',
]

interface ContentRegion {
  start: number
  end: number
  openTag: string
  html: string
}

/** กล่องเนื้อหาบทความ (ส่วนที่ผู้เขียนเขียน) ในหน้าโพสต์ที่ render จริง — ไม่เจอคืน null */
function postContentRegion(page: string): ContentRegion | null {
  const b = Math.max(0, page.search(/<body\b/i))
  for (const cls of CONTENT_CLASSES) {
    const re = new RegExp(`<([a-z][\\w-]*)\\b[^>]*\\sclass=["'][^"']*(?<![\\w-])${cls}(?![\\w-])[^"']*["'][^>]*>`, 'gi')
    re.lastIndex = b
    const m = re.exec(page)
    if (!m) continue
    const end = balancedEnd(page, m.index, m[1].toLowerCase())
    if (end === -1) continue
    return { start: m.index, end, openTag: m[0], html: page.slice(m.index, end) }
  }
  const i = page.search(/<article\b/i)
  if (i !== -1) {
    const e = balancedEnd(page, i, 'article')
    if (e !== -1) {
      const openTag = /^<article\b[^>]*>/i.exec(page.slice(i))?.[0] || '<article>'
      return { start: i, end: e, openTag, html: page.slice(i, e) }
    }
  }
  return null
}

/** ตัด element ที่แท็กเปิดตรง re ออกทั้งก้อน (นับซ้อน) */
function removeElements(html: string, re: RegExp): string {
  let out = html
  for (let guard = 0; guard < 30; guard++) {
    re.lastIndex = 0
    const m = re.exec(out)
    if (!m) break
    const tag = /^<([a-z][\w-]*)/i.exec(m[0])?.[1]?.toLowerCase() || 'div'
    const e = balancedEnd(out, m.index, tag)
    out = out.slice(0, m.index) + (e === -1 ? out.slice(m.index + m[0].length) : out.slice(e))
  }
  return out
}

/**
 * template ของหน้าบทความ = ทุกอย่างใน body ยกเว้นเนื้อหาที่ผู้เขียนเขียน, header/footer/เมนู/popup
 * ของที่อยู่ตรงนี้ทุกบทความ = ปลั๊กอิน/ธีม/template ใส่ให้เอง (เช่น widget สารบัญของ Elementor ใน single template)
 * keepSidebar: สารบัญใน sidebar ก็เป็นของปลั๊กอินที่แสดงทุกบทความ แต่ CTA/FAQ ใน sidebar เป็นของทั้งเว็บ ไม่ซ้อนกับในบทความ
 */
function templateRegion(page: string, region: ContentRegion | null, keepSidebar = false): string {
  const b = page.search(/<body\b/i)
  let html = region ? page.slice(0, region.start) + page.slice(region.end) : page
  if (b !== -1) html = html.slice(b)
  html = html.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
  html = removeElements(html, /<(?:header|footer)\b[^>]*>/gi)
  // เมนูนำทาง (ไม่ใช่ nav ของสารบัญ)
  html = removeElements(html, /<nav\b(?![^>]*(?:สารบัญ|toc|table-of-contents))[^>]*>/gi)
  if (!keepSidebar) html = removeElements(html, /<aside\b[^>]*>/gi)
  html = removeElements(html, /<[a-z][\w-]*\b[^>]*data-elementor-type=["'](?:header|footer|popup)["'][^>]*>/gi)
  return html
}

/** ส่วนเนื้อบทความของหน้าโพสต์ (ใช้กับ CTA — ปุ่มโทร/LINE ใน header/footer ไม่นับ) */
function articleRegion(html: string): string {
  const region = postContentRegion(html)
  if (region) return region.html
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
  const templateLabels: string[] = []
  let authorPosts = 0
  let templatePosts = 0
  let knownAuto = false

  for (const p of posts) {
    const region = p.page ? postContentRegion(p.page) : null
    // เนื้อหาที่ผู้เขียนเขียน: REST content.rendered ก่อน (เนื้อดิบ) — ไม่มี REST ใช้กล่องเนื้อหาในหน้าจริง
    const inRest = p.content !== null ? matchDetectors(p.content, key) : []
    const inRendered = p.page ? matchDetectors(region ? region.html : stripChrome(p.page), key) : []
    const author = p.content !== null ? inRest : inRendered
    // template ของหน้าบทความ (นอกกล่องเนื้อหา) — ต้องเจอกล่องเนื้อหาก่อน ไม่งั้นแยกไม่ได้ว่าอะไรเป็นของผู้เขียน
    const inTemplate =
      p.page && region
        ? matchDetectors(templateRegion(p.page, region, key === 'toc'), key).filter((d) => !d.weak && d.templateOk !== false)
        : []
    // มีในกล่องเนื้อหาที่ render แต่เนื้อดิบจาก REST ไม่มี = ปลั๊กอินแทรกให้ตอนแสดงผล (the_content filter)
    const injected =
      p.content !== null && region ? inRendered.filter((d) => !d.weak && d.templateOk !== false && !inRest.some((x) => x.label === d.label)) : []

    if (author.length) authorPosts++
    if (inTemplate.length || injected.length) templatePosts++
    for (const d of [...author, ...inTemplate, ...injected]) {
      labels.push(d.label)
      if (d.autoInsert && !d.weak) knownAuto = true
    }
    for (const d of [...inTemplate, ...injected]) templateLabels.push(d.label)
  }
  const postsChecked = posts.filter((p) => p.content !== null || p.page !== null).length
  const renderedCount = posts.filter((p) => p.page !== null).length
  // template ต้องเจอในหน้าบทความจริงอย่างน้อย 2 หน้าถึงเชื่อว่าเป็นทุกบทความ (เปิดได้หน้าเดียว = เชื่อหน้าเดียว)
  const fromTemplate = templatePosts >= 2 || (renderedCount === 1 && templatePosts === 1)
  const homeHits = home ? matchDetectors(stripChrome(home), key, { home: true }) : []

  // ตัดของเราออก (auto) เฉพาะเมื่อปลั๊กอิน/ธีม/template ใส่ให้ทุกบทความเอง
  // ผู้เขียนเขียนเองในเนื้อหา (กี่บทความก็ตาม) ไม่ติดมากับบทความใหม่ → ยังใส่ของเรา
  let where: UploadComponentFinding['where'] = null
  if (knownAuto || fromTemplate) where = 'auto'
  else if (authorPosts > 0) where = 'some-posts'
  else if (homeHits.length) where = 'site'

  if (knownAuto) evidence.push('เป็นปลั๊กอินที่แทรกให้ทุกบทความเองโดยค่าเริ่มต้น — ไม่ใส่ของเราซ้ำ')
  if (fromTemplate) {
    evidence.push(
      `อยู่ใน template ของหน้าบทความ (นอกเนื้อหาที่ผู้เขียนเขียน) ${templatePosts}/${renderedCount} หน้า: ${uniq(templateLabels).join(', ')} — ปลั๊กอิน/ธีมใส่ให้ทุกบทความเอง`,
    )
  }
  if (authorPosts) {
    evidence.push(
      where === 'auto'
        ? `ผู้เขียนเขียนเองในเนื้อหาด้วย ${authorPosts}/${postsChecked} บทความ`
        : `ผู้เขียนเขียนเองในเนื้อหา ${authorPosts}/${postsChecked} บทความ — ไม่ใช่ปลั๊กอิน ระบบยังใส่ของเรา`,
    )
  } else if (postsChecked) {
    evidence.push(`ไม่พบในเนื้อหาบทความ 0/${postsChecked} บทความที่สุ่มดู`)
  }
  if (!authorPosts && !fromTemplate && homeHits.length) evidence.push(`เจอนอกบทความ (หน้าแรก): ${uniq(homeHits.map((d) => d.label)).join(', ')}`)
  if (key === 'toc') {
    const installed = pluginSlugs.filter((s) => TOC_PLUGIN_SLUGS.includes(s))
    if (installed.length) evidence.push(`เว็บโหลดไฟล์ของปลั๊กอินสารบัญ: ${installed.map(prettySlug).join(', ')}`)
  }

  // source = ตัวที่ใช้ตัดสิน (template/ปลั๊กอินก่อน)
  const allLabels = uniq([...(where === 'auto' ? templateLabels : []), ...labels, ...homeHits.map((d) => d.label)])
  return {
    found: where !== null,
    where,
    source: allLabels[0] || '',
    postsWith: authorPosts,
    postsChecked,
    evidence: [...evidence, ...(allLabels.length > 1 ? [`สัญญาณที่เจอ: ${allLabels.join(', ')}`] : [])],
  }
}

// ── FAQ / content style (CSS) ───────────────────────────────────────────────

const FAQ_HEADING_RE = /<h([2-4])\b[^>]*>(?:(?!<\/h\1>)[\s\S]){0,300}?(?:คำถามที่พบบ่อย|คำถามยอดฮิต|FAQ|Frequently Asked Questions)(?:(?!<\/h\1>)[\s\S]){0,300}?<\/h\1>/i

/** ส่วน FAQ ใต้หัวข้อ "คำถามที่พบบ่อย" ในบทความ (ถึงหัวข้อระดับเดียวกันถัดไป) — ต้องมีรายการคำถามจริง */
function faqSectionByHeading(page: string): string | null {
  const doc = articleRegion(page)
  const m = FAQ_HEADING_RE.exec(doc)
  if (!m) return null
  const start = m.index
  const after = start + m[0].length
  const next = doc.slice(after).search(new RegExp(`<h[1-${m[1]}]\\b`, 'i'))
  const html = doc.slice(start, Math.min(next === -1 ? doc.length : after + next, start + 6000))
  return /<details\b|<dt\b|<h[3-5]\b|accordion|toggle/i.test(html.slice(m[0].length)) ? html : null
}

/**
 * ตัวอย่าง HTML ของ FAQ element จริงบนเว็บ (≤6KB) + index ของหน้าที่เจอ
 * ลำดับ: กล่อง FAQ ของปลั๊กอิน/ธีมที่มี class ชัด → ส่วนใต้หัวข้อ "คำถามที่พบบ่อย" → details/summary เปล่าในบทความ
 */
function extractFaqSnippet(pages: string[]): { html: string; label: string; pageIndex: number } | null {
  const tidy = (html: string) => html.replace(/\s+/g, ' ')
  for (let i = 0; i < pages.length; i++) {
    const doc = stripChrome(pages[i])
    for (const d of DETECTORS.faq) {
      if (!d.element || d.weak) continue
      const m = d.re.exec(doc)
      if (!m) continue
      const tagStart = doc.lastIndexOf('<', m.index)
      const tag = /^<([a-z0-9]+)/i.exec(doc.slice(tagStart))?.[1]?.toLowerCase()
      if (!tag || tagStart < 0) continue
      const end = balancedEnd(doc, tagStart, tag)
      const html = doc.slice(tagStart, end === -1 ? tagStart + 6000 : Math.min(end, tagStart + 6000))
      return { html: tidy(html), label: d.label, pageIndex: i }
    }
  }
  for (let i = 0; i < pages.length; i++) {
    const html = faqSectionByHeading(pages[i])
    if (html) return { html: tidy(html), label: 'ส่วน "คำถามที่พบบ่อย" ในบทความ', pageIndex: i }
  }
  for (let i = 0; i < pages.length; i++) {
    const doc = articleRegion(pages[i])
    const at = doc.search(/<details\b[^>]*>\s*<summary\b/i)
    if (at !== -1) return { html: tidy(doc.slice(at, at + 6000)), label: 'FAQ แบบ details/summary ในบทความ', pageIndex: i }
  }
  return null
}

/** tag ของ FAQ ที่ไม่มี class (details/summary/dl) — ใช้จับกฎ CSS แบบ `.x details summary` */
function faqTags(html: string): string[] {
  return ['details', 'summary', 'dl', 'dt', 'dd'].filter((t) => new RegExp(`<${t}\\b`, 'i').test(html))
}

const GENERIC_CLASS = /^(?:wp-block-.*|elementor-(?:element|widget-wrap|column|section|container)|e-con.*|has-.*|is-.*|alignwide|alignfull|clearfix|active|open|show|content-.*)$/i

function classTokens(html: string): string[] {
  const tokens = Array.from(html.matchAll(/class="([^"]+)"/gi)).flatMap((m) => m[1].split(/\s+/))
  return uniq(tokens.filter((t) => t && t.length <= 60 && /^[\w-]+$/.test(t) && !GENERIC_CLASS.test(t))).slice(0, 40)
}

/**
 * CSS ที่ฝังมาในเนื้อหน้า (<style> หลัง <body>) — บทความที่วาง HTML สำเร็จรูปมักพก CSS ของตัวเองมา
 * (เช่น .cc-article) ผู้อ่านเห็นค่านี้จริง ทับค่าตั้งต้นของธีม
 */
function bodyStyleCss(page: string): string {
  const b = page.search(/<body\b/i)
  if (b === -1) return ''
  return Array.from(stripChrome(page.slice(b)).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi), (m) => m[1]).join('\n')
}

/** ไฟล์ CSS ที่ไม่เกี่ยวกับสีบทความ (ฟอนต์ไอคอน ฯลฯ) */
const SKIP_CSS = /fonts\.googleapis|font-awesome|fontawesome|dashicons|eicons|swiper|animations?\.min|lightbox|smallscreen|print\.css/i

/**
 * CSS ทั้งหน้าตามลำดับในเอกสารจริง (<style> + <link rel=stylesheet> ทั้งใน head และ body) — ลำดับมีผลกับ cascade
 * ข้าม stylesheet ที่ media ไม่ใช้กับจอเดสก์ท็อป (print, max-width มือถือ/แท็บเล็ต) เหมือนเบราว์เซอร์
 * ไฟล์ลิงก์ดึงได้ไม่เกิน 24 ไฟล์ ถ้าเกินเลือกไฟล์ของธีม/ไฟล์ CSS ต่อโพสต์ (uploads) ก่อน แล้วค่อยไฟล์ widget ของปลั๊กอิน
 */
async function collectCss(page: string, base: string): Promise<string> {
  const parts: Array<{ css?: string; href?: string }> = []
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>|<link\b[^>]*>/gi
  // <script> อาจมีสตริง "<style" — ตัดออกก่อน
  const doc = page.replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
  let m: RegExpExecArray | null
  while ((m = re.exec(doc))) {
    const media = /\smedia=["']([^"']*)["']/i.exec(/^<[^>]*>/.exec(m[0])?.[0] || '')?.[1]
    if (media && !mediaApplies(media)) continue
    if (m[1] !== undefined) {
      parts.push({ css: m[1] })
      continue
    }
    const tag = m[0]
    if (!/rel=["']?stylesheet/i.test(tag)) continue
    const raw = /href=["']([^"']+)["']/i.exec(tag)?.[1]
    if (!raw) continue
    try {
      const href = new URL(raw.replace(/&amp;/g, '&'), base).toString()
      if (/^https:\/\//i.test(href) && !SKIP_CSS.test(href)) parts.push({ href })
    } catch {
      /* URL เสีย */
    }
  }
  let hrefs = uniq(parts.filter((p) => p.href).map((p) => p.href as string))
  if (hrefs.length > 24) {
    const pri = (h: string) => (/\/uploads\/|\/themes\//i.test(h) ? 0 : /\/plugins\/[^?]*\/widget-|\/lib\//i.test(h) ? 2 : 1)
    const keep = new Set([...hrefs].sort((a, b) => pri(a) - pri(b)).slice(0, 24))
    hrefs = hrefs.filter((h) => keep.has(h))
  }
  const files = new Map<string, string>()
  await Promise.all(hrefs.map((h) => fetchText(h).then((t) => files.set(h, (t || '').slice(0, 800_000)))))
  return parts.map((p) => (p.css !== undefined ? p.css : files.get(p.href as string) || '')).join('\n')
}

/** URL ที่มีภาษาไทย/อีโมจิแบบ %xx → อ่านออก (ใช้แสดงผลเท่านั้น) */
function readableUrl(u: string): string {
  try {
    return decodeURI(u)
  } catch {
    return u
  }
}

function parseRules(css: string): CssRule[] {
  return parseCssRules(css)
}

// ── สีจริงของบทความ (คำนวณจาก CSS) ─────────────────────────────────────────

export interface ComputedArticleStyle {
  /** สีตัวอักษรย่อหน้า */
  text: string | null
  /** สีหัวข้อ h2 (ไม่มี h2 ใช้ h3) */
  heading: string | null
  /** สีลิงก์ในเนื้อหา */
  link: string | null
  /** พื้นหลังของบทความเอง — '' = โปร่งใส (เห็นพื้นของหน้าเว็บด้านหลัง) */
  background: string
  /** สีพื้นที่ผู้อ่านเห็นหลังตัวอักษรจริง (พื้นบทความ หรือพื้นของ section/หน้าเว็บด้านหลังถ้าบทความโปร่งใส) */
  backdrop: string
  bodyFont: string | null
  headingFont: string | null
  /** element ที่ใช้คำนวณ (ไว้แสดงเป็นหลักฐาน) */
  sampled: string[]
}

/** chain ของ element ที่ index (รวมตัวมันเอง) — openTag = แท็กเปิดของ element นั้น */
function chainFor(page: string, index: number, openTag: string): CssEl[] {
  return [...openChainAt(page, index), parseOpenTag(openTag)]
}

/**
 * element ในกล่องเนื้อหาที่ตรง re (re ต้องมี flag g และจับแท็กเปิดที่ group 1 หรือทั้งก้อน) — ดู 8 ตัวแรก
 * เลือกตัวที่อยู่ตื้นสุดจากกล่องเนื้อหา (กันไปเจอย่อหน้าในกล่อง CTA/ไฮไลต์ที่มีสีของตัวเอง)
 */
function bestInContent(page: string, region: ContentRegion, re: RegExp): CssEl[] | null {
  const offset = region.start + region.openTag.length
  const inner = page.slice(offset, region.end)
  let best: CssEl[] | null = null
  let m: RegExpExecArray | null
  re.lastIndex = 0
  for (let n = 0; n < 8 && (m = re.exec(inner)); n++) {
    const tagHtml = m[1] || /^<[^>]*>/.exec(m[0])?.[0] || m[0]
    const at = offset + m.index + m[0].length - (m[1] ? m[1].length : m[0].length)
    const chain = chainFor(page, at, tagHtml)
    if (!best || chain.length < best.length) best = chain
  }
  return best
}

const describe = (el: CssEl) => `${el.tag}${el.id ? `#${el.id}` : ''}${Array.from(el.classes).slice(0, 3).map((c) => `.${c}`).join('')}`

/**
 * สี/ฟอนต์ที่ผู้อ่านเห็นจริงในกล่องเนื้อหาบทความ — cascade จาก CSS ของหน้า (ไม่ใช้ AI)
 * พื้นหลัง: element ระหว่างย่อหน้าถึงกล่องเนื้อหามีพื้นของตัวเอง = พื้นบทความ, ไม่มี = โปร่งใส (ใช้พื้นของ section/หน้าเว็บ)
 */
function computeArticleStyle(page: string, rules: CssRule[]): ComputedArticleStyle | null {
  const region = postContentRegion(page)
  if (!region) return null
  const cascade = new CssCascade(rules)
  const contentChain = chainFor(page, region.start, region.openTag)
  const virtual = (tag: string): CssEl => ({ tag, id: '', classes: new Set() })

  // ย่อหน้าที่มีตัวอักษรจริง (ไม่ใช่ p ว่าง/p ที่มีแต่รูป)
  const pChain = bestInContent(page, region, /<p\b[^>]*>(?=\s*(?:<(?:strong|b|em|span|a)\b[^>]*>\s*)*[^<\s])/gi) || [...contentChain, virtual('p')]
  const hChain = bestInContent(page, region, /<h2\b[^>]*>/gi) || bestInContent(page, region, /<h3\b[^>]*>/gi) || [...contentChain, virtual('h2')]
  // ลิงก์ในย่อหน้า (ไม่ใช่ปุ่ม) → ลิงก์ไหนก็ได้ในเนื้อหา → ลิงก์สมมุติใต้ย่อหน้า
  const aChain =
    bestInContent(page, region, /<p\b[^>]*>(?:(?!<\/p>)[\s\S])*?(<a\b[^>]*href=[^>]*>)/gi) ||
    bestInContent(page, region, /<a\b(?![^>]*class=["'][^"']*(?:btn|button))[^>]*href=[^>]*>/gi) ||
    [...pChain, virtual('a')]

  const color = (chain: CssEl[]) => {
    const v = cascade.inherited(chain, 'color')
    const hex = v ? toHex(v.value) : null
    return hex && hex !== 'transparent' ? hex : null
  }
  // ลิงก์ไม่สืบทอดสีจากพ่อ (เบราว์เซอร์ตั้ง a:link เป็นสีน้ำเงิน) เว้นแต่ CSS สั่ง inherit/currentColor
  const linkColor = () => {
    const raw = cascade.declared(aChain, 'color')
    if (raw === null) return '#0000ee'
    const v = cascade.resolve(raw, aChain)
    if (/^(?:inherit|currentcolor|unset)$/i.test(v)) return color(aChain.slice(0, -1))
    const hex = toHex(v)
    return hex && hex !== 'transparent' ? hex : null
  }
  const font = (chain: CssEl[]) => {
    const v = cascade.inherited(chain, 'font-family')?.value
    return v ? v.replace(/\s+/g, ' ').trim() : null
  }

  // พื้นหลัง: ไล่จากย่อหน้าขึ้นไปถึงกล่องเนื้อหา = พื้นของบทความ, เหนือกว่านั้น = พื้นหน้าเว็บด้านหลัง
  const contentDepth = contentChain.length - 1
  let background = ''
  for (let i = pChain.length - 2; i >= contentDepth; i--) {
    const bg = cascade.background(pChain.slice(0, i + 1))
    if (bg) {
      background = bg
      break
    }
  }
  let backdrop = background
  if (!backdrop) {
    for (let i = contentDepth - 1; i >= 0; i--) {
      const bg = cascade.background(pChain.slice(0, i + 1))
      if (bg) {
        backdrop = bg
        break
      }
    }
  }

  return {
    text: color(pChain),
    heading: color(hChain),
    link: linkColor(),
    background,
    backdrop: backdrop || '#ffffff',
    bodyFont: font(pChain),
    headingFont: font(hChain),
    sampled: [describe(contentChain[contentChain.length - 1]), describe(pChain[pChain.length - 1]), describe(hChain[hChain.length - 1]), describe(aChain[aChain.length - 1])],
  }
}

/** ผสมสี hex สองสี (w = สัดส่วนของสีที่สอง) */
function mixHex(a: string, b: string, w: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16)
  return `#${[0, 1, 2].map((i) => Math.round(ch(a, i) * (1 - w) + ch(b, i) * w).toString(16).padStart(2, '0')).join('')}`
}

/** ตัวอักษรอ่านออกบนพื้นนี้ไหม (contrast ≥ 3) */
function readable(fg: string | undefined, bg: string): boolean {
  if (!fg || !/^#[0-9a-f]{6}$/i.test(fg) || !/^#[0-9a-f]{6}$/i.test(bg)) return true
  return contrast(fg, bg) >= 3
}

/** เติม #rrggbb จาก #rgb */
function hex6(v: string | undefined): string | undefined {
  if (!v) return undefined
  const h = toHex(v)
  return h && h !== 'transparent' ? h : undefined
}

/**
 * กัน FAQ/ตารางที่ AI เสนออ่านไม่ออกบนพื้นจริงของเว็บ (เช่น กล่องขาวตัวหนังสือขาวบนเว็บพื้นเข้ม)
 * พื้นกล่องที่ขัดกับพื้นเว็บชัด ๆ (ขาวบนพื้นเข้ม) ถูกเปลี่ยนเป็นโปร่งใส แล้วตัวอักษรที่อ่านไม่ออกใช้สีตัวอักษรของบทความ
 */
function fitDetailToBackdrop(detail: UploadThemeDetail, style: ComputedArticleStyle): UploadThemeDetail {
  const back = style.background || style.backdrop
  const dark = /^#[0-9a-f]{6}$/i.test(back) && luminance(back) < 0.2
  const text = style.text || (dark ? '#ffffff' : '#111111')
  const f = detail.faq ? { ...detail.faq } : undefined
  if (f) {
    const lightBox = (v: string | undefined) => {
      const h = hex6(v)
      return !!h && dark && luminance(h) > 0.6
    }
    for (const k of ['itemBackground', 'questionBackground', 'answerBackground', 'openQuestionBackground'] as const) {
      if (lightBox(f[k])) f[k] = 'transparent'
    }
    const bgOf = (...vs: Array<string | undefined>) => hex6(vs.find((v) => v && v !== 'transparent')) || back
    const itemBg = bgOf(f.itemBackground)
    const qBg = bgOf(f.questionBackground, f.itemBackground)
    const oqBg = bgOf(f.openQuestionBackground, f.questionBackground, f.itemBackground)
    const aBg = bgOf(f.answerBackground, f.itemBackground)
    if (!readable(hex6(f.questionColor), qBg)) f.questionColor = readable(text, qBg) ? text : undefined
    if (!readable(hex6(f.openQuestionColor), oqBg)) f.openQuestionColor = readable(text, oqBg) ? text : undefined
    if (!readable(hex6(f.answerColor), aBg)) f.answerColor = readable(text, aBg) ? text : undefined
    if (!readable(hex6(f.iconColor), qBg)) f.iconColor = undefined
    if (dark && !f.questionColor && !readable('#000000', qBg)) f.questionColor = text
    // ขอบสีเกือบเท่าพื้นจะมองไม่เห็น — ปล่อยให้ใช้สีขอบของธีม
    if (f.itemBorderColor && hex6(f.itemBorderColor) && contrast(hex6(f.itemBorderColor) as string, itemBg) < 1.3) f.itemBorderColor = undefined
  }
  let t = detail.table ? { ...detail.table } : undefined
  // หัวตาราง default = พื้นสีหลัก (สีหัวข้อ) + ตัวขาว — หัวข้อสีอ่อน (เว็บพื้นเข้ม) จะกลายเป็นขาวบนขาว ต้องตั้งพื้นหัวตารางให้เอง
  const heading = hex6(style.heading || undefined)
  if (!t?.headerBackground && heading && luminance(heading) > 0.6) {
    t = { ...(t || {}), headerBackground: dark ? mixHex(back, '#ffffff', 0.12) : '#1f2937', headerColor: dark ? text : '#ffffff' }
  }
  if (t) {
    if (t.stripeBackground && dark && luminance(hex6(t.stripeBackground) || '#000000') > 0.6) t.stripeBackground = 'rgba(255,255,255,.06)'
    const headBg = hex6(t.headerBackground)
    if (headBg && t.headerColor && !readable(hex6(t.headerColor), headBg)) t.headerColor = undefined
  }
  return { ...detail, ...(f ? { faq: f } : {}), ...(t ? { table: t } : {}) }
}

function resolveVars(body: string, vars: Map<string, string>): string {
  let out = body
  for (let i = 0; i < 3 && out.includes('var('); i++) {
    out = out.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (all, name: string, fb?: string) => vars.get(name) ?? fb?.trim() ?? all)
  }
  return out
}

const CONTENT_SEL = /(?:entry-content|post-content|single-content|article-content|the-content|elementor-widget-theme-post-content|wp-block-post-content|\barticle)[^,{]*\b(?:h2|h3|a|table|th|td|p|blockquote)\b|^(?:body|h2|h3|a|table|th|td)$/i

function cssVars(rules: CssRule[]): Map<string, string> {
  const vars = new Map<string, string>()
  for (const r of rules) {
    if (!/(?::root|^html|^body|\.editor-styles-wrapper)/i.test(r.selector)) continue
    for (const m of Array.from(r.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g))) if (!vars.has(m[1])) vars.set(m[1], m[2].trim())
  }
  return vars
}

function ruleLine(r: CssRule, vars: Map<string, string>): string | null {
  const body = resolveVars(r.body.replace(/(?:^|;)\s*--[\w-]+\s*:[^;]*/g, ''), vars).trim()
  return body ? `${r.selector.replace(/\s+/g, ' ')}{${body.replace(/\s+/g, ' ')}}` : null
}

/** CSS ที่บทความฝังมาเองทั้งก้อน (≤14KB) — ตัวแปรหาจากทั้ง CSS ของบทความและธีม */
function articleOwnCss(articleRules: CssRule[], themeRules: CssRule[]): string {
  const vars = cssVars([...articleRules, ...themeRules])
  const out: string[] = []
  let len = 0
  for (const r of articleRules) {
    const line = ruleLine(r, vars)
    if (!line || len >= 14_000) continue
    out.push(line)
    len += line.length
  }
  return out.join('\n')
}

function relevantCss(rules: CssRule[], tokens: string[], tags: string[] = []): { faqCss: string; contentCss: string } {
  const vars = cssVars(rules)
  const tokenRe = tokens.length ? new RegExp(`\\.(?:${tokens.map((t) => t.replace(/[-]/g, '\\-')).join('|')})(?![\\w-])`) : null
  const tagRe = tags.length ? new RegExp(`(?:^|[\\s>+~,(])(?:${tags.join('|')})(?![\\w-])`, 'i') : null
  const faq: string[] = []
  const content: string[] = []
  let faqLen = 0
  let contentLen = 0
  for (const r of rules) {
    const line = ruleLine(r, vars)
    if (!line) continue
    if (((tokenRe && tokenRe.test(r.selector)) || (tagRe && tagRe.test(r.selector))) && faqLen < 14_000) {
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
- ถ้ามีหัวข้อ "สีที่คำนวณจาก CSS จริง" ให้ถือเป็นความจริงสูงสุด colors/fonts ต้องตรงกับค่านั้น (ระบบจะใช้ค่านั้นทับอยู่แล้ว)
  ใช้ค่านั้นประกอบการเสนอหน้าตา FAQ/ตารางให้เข้ากับบทความ
- "พื้นหลังที่ผู้อ่านเห็น" เป็นสีเข้ม (ตัวอักษรบทความสีขาว/อ่อน) → ห้ามเสนอกล่อง FAQ/ตารางพื้นขาวหรือพื้นอ่อน + ตัวอักษรเข้ม
  ให้ itemBackground/questionBackground/answerBackground เป็น "transparent" หรือสีเข้มใกล้พื้นหลังนั้น (เช่นสีกล่องที่บทความใช้อยู่)
  questionColor/answerColor = สีตัวอักษรบทความ, iconColor/เส้นขอบใช้สีลิงก์หรือสีอ่อนโปร่ง ๆ ที่มองเห็นบนพื้นเข้ม
- บทความไม่มีพื้นหลังของตัวเอง (โปร่งใส) → colors.background เว้นว่าง
- ลำดับความสำคัญของหลักฐาน: "CSS ที่บทความฝังมาเอง" สูงสุด (ผู้อ่านเห็นค่านี้จริง) > "CSS ของกล่อง FAQ" > "CSS ธีม"
  ถ้ามี CSS ที่บทความฝังมาเอง ให้เอาทุกค่าจากก้อนนั้น ห้ามใช้ค่าตั้งต้นของธีม/reset (เช่น a{color}, body{font-family} แบบกว้าง ๆ) มาแทน
- colors.theme = สีตัวอักษรหัวข้อ h2 จริง (แม้เป็นสีเทาเข้ม/ดำก็ใช้ค่านั้น ห้ามเอาสีลิงก์มาใส่), colors.text = สีตัวอักษรย่อหน้า p, colors.border = สีขอบกล่อง/ตาราง, colors.accent = สีลิงก์ในบทความ
- fonts คัด font-family ตามที่เขียนใน CSS ตรง ๆ (รวม fallback)
- faq ให้คัดจาก CSS ของ details/summary หรือ class ของกล่อง FAQ ตรง ๆ: questionBackground = พื้น summary, questionWeight = font-weight ของ summary, icon ดูจาก content ของ ::after/::before ('+' = plus, ลูกศร = chevron/arrow) ถ้า summary ไม่มี list-style:none และไม่มี pseudo = ลูกศรเริ่มต้นของเบราว์เซอร์ (caret ซ้าย), iconColor = color ของ pseudo นั้น, answerPadding = padding ของย่อหน้าคำตอบ
- table ให้คัดจาก th/thead th/tr:nth-child (headerBackground, headerColor, borderColor, stripeBackground)
- สีเป็น hex เท่านั้น (#rrggbb) ถ้า CSS เป็น rgb() ให้แปลงเป็น hex (ยกเว้นพื้นกล่อง FAQ ใช้ "transparent" ได้)
- ตัวเลขขนาด (radius/gap/borderWidth) เป็น number หน่วย px, padding เป็นสตริง CSS เช่น "16px 20px"
- ถ้าไม่มีกล่อง FAQ บนเว็บเลย ให้ faq ใช้สี/ขอบ/มุมโค้งจาก CSS บทความ และบอกใน summary ว่าเป็นค่าที่เสนอ
- summary เป็นภาษาไทย 2-4 ประโยค อธิบายว่าเว็บแสดง FAQ และบทความอย่างไร (เช่น กล่องมีขอบมุมโค้ง ไอคอนลูกศรขวา หัวข้อสีน้ำเงิน)
ตอบ JSON รูปแบบนี้เท่านั้น:
{"colors":{"theme":"สีหลัก/หัวข้อ","text":"สีตัวอักษรเนื้อหา","border":"สีเส้นขอบ","accent":"สีลิงก์","background":"พื้นหลังบทความ ถ้าเป็นสีขาวหรือโปร่งใสให้เว้นว่าง"},
"fonts":{"body":"font-family เนื้อหา","heading":"font-family หัวข้อ"},
"faq":{"layout":"card|divider|plain","itemBackground":"","itemBorderColor":"","itemBorderWidth":1,"itemRadius":8,"itemGap":12,"itemShadow":false,"questionBackground":"","questionColor":"","questionFontSize":"18px","questionWeight":600,"questionPadding":"16px 20px","openQuestionBackground":"","openQuestionColor":"","answerBackground":"","answerColor":"","answerPadding":"0 20px 16px","icon":"plus|chevron|caret|arrow|none","iconPosition":"left|right","iconColor":""},
"table":{"headerBackground":"","headerColor":"","borderColor":"","stripeBackground":""},
"summary":""}`

async function analyzeStyle(input: {
  faqSnippet: string
  faqLabel: string
  articleCss: string
  faqCss: string
  contentCss: string
  /** CSS ของ class ที่ใช้ในเนื้อบทความ (เช่นกล่อง CTA ที่ผู้เขียนเขียนเอง) */
  contentClassCss: string
  computed: ComputedArticleStyle | null
}): Promise<{ data: AiStyle | null; usage: ORUsage | null; error: string | null }> {
  if (!input.articleCss && !input.faqCss && !input.contentCss && !input.faqSnippet && !input.computed) return { data: null, usage: null, error: 'ไม่พบ CSS ของเว็บให้วิเคราะห์' }
  const c = input.computed
  const computedBlock = c
    ? [
        '## สีที่คำนวณจาก CSS จริง (ความจริงสูงสุด — คำนวณ cascade แล้ว)',
        `- ตัวอักษรย่อหน้า: ${c.text || '(ไม่ทราบ)'}`,
        `- หัวข้อ h2: ${c.heading || '(ไม่ทราบ)'}`,
        `- ลิงก์: ${c.link || '(ไม่ทราบ)'}`,
        `- พื้นหลังของบทความเอง: ${c.background || 'ไม่มี (โปร่งใส)'}`,
        `- พื้นหลังที่ผู้อ่านเห็นหลังตัวอักษร: ${c.backdrop} (${luminance(c.backdrop) < 0.2 ? 'สีเข้ม' : 'สีอ่อน'})`,
        `- ฟอนต์เนื้อหา: ${c.bodyFont || '(ไม่ทราบ)'} / ฟอนต์หัวข้อ: ${c.headingFont || '(ไม่ทราบ)'}`,
      ].join('\n')
    : ''
  const user = [
    ...(computedBlock ? [computedBlock] : []),
    input.faqSnippet ? `## กล่อง FAQ บนเว็บ (${input.faqLabel})\n${input.faqSnippet}` : '## เว็บนี้ไม่มีกล่อง FAQ ในบทความที่สุ่มดู',
    `## CSS ที่บทความฝังมาเอง (สำคัญสุด — ผู้อ่านเห็นค่านี้จริง)\n${input.articleCss || '(ไม่มี)'}`,
    `## CSS ของกล่อง FAQ (จากไฟล์ธีม/ปลั๊กอิน)\n${input.faqCss || '(ไม่มี)'}`,
    `## CSS ธีมสำหรับเนื้อหาบทความ (ค่าตั้งต้น — ใช้เมื่อ CSS ที่บทความฝังมาไม่ได้กำหนด)\n${input.contentCss || '(ไม่มี)'}`,
    ...(input.contentClassCss ? [`## CSS ของกล่องที่ใช้ในเนื้อบทความ (เช่นกล่อง CTA ที่ผู้เขียนเขียนเอง — ใช้เป็นแนวทางสี/มุมโค้งของกล่อง)\n${input.contentClassCss}`] : []),
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
  let target = normalizeSite(siteUrl)
  const checked: string[] = []
  const warnings: string[] = []
  const sample = sampleUrl?.trim() ? normalizeSite(sampleUrl) : ''

  // ลิงก์ตัวอย่างอยู่คนละเว็บกับ URL ที่สแกน — ผลต้องมาจากเว็บเดียวกันทั้งหมด ไม่งั้นหน้าตาปนกัน 2 เว็บ
  if (sample) {
    try {
      const sHost = new URL(sample).host.replace(/^www\./, '')
      const tHost = new URL(target).host.replace(/^www\./, '')
      if (sHost !== tHost) {
        target = new URL(sample).origin
        warnings.push(`ลิงก์บทความตัวอย่างอยู่คนละเว็บกับ URL ที่สแกน — สแกนตามเว็บของลิงก์ตัวอย่าง (${sHost}) แทน`)
      }
    } catch {
      /* URL เสีย — normalizeSite จัดการแล้ว */
    }
  }

  const homeRes = await fetchHtml(target)
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
  const toRender = uniq([...(sample ? [sample] : []), ...posts.map((p) => p.link)]).slice(0, sample ? 4 : 3)
  const rendered = await Promise.all(toRender.map((u) => fetchHtml(u)))
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
  // หน้าที่ใช้อ่าน CSS: ลิงก์ตัวอย่างที่ผู้ใช้ใส่ (เปิดได้) ชนะเสมอ → หน้าที่เจอ FAQ → หน้าที่มี CSS ฝังในบทความ → บทความแรก → หน้าแรก
  // (แต่ละบทความบนเว็บเดียวกันอาจพก CSS คนละชุด ลิงก์ตัวอย่างจึงต้องชนะ แม้หน้าตัวอย่างไม่มี FAQ ก็ตาม)
  const isSample = (p: PostSample) => !!sample && p.link.replace(/\/$/, '') === sample.replace(/\/$/, '')
  const postEntries = posts
    .filter((p): p is PostSample & { page: string } => !!p.page)
    .sort((a, b) => Number(isSample(b)) - Number(isSample(a)))
  const sampleEntry = postEntries[0] && isSample(postEntries[0]) ? postEntries[0] : null
  if (sample && !sampleEntry) warnings.push('เปิดลิงก์บทความตัวอย่างไม่ได้ — ใช้บทความอื่นของเว็บแทน')
  // FAQ ตัวอย่าง (pageIndex = index ใน postEntries, -1 = หน้าแรก):
  // หน้าตัวอย่างก่อน → บทความอื่นที่ไม่ได้ฝัง CSS ของตัวเอง (หน้าตาตามธีม) → (ไม่มีตัวอย่าง) บทความไหนก็ได้ → หน้าแรก
  // มีตัวอย่างแล้วห้ามหยิบบทความที่ฝัง CSS คนละชุดมา — หน้าตาจะไม่ตรงกับตัวอย่าง
  let snippet: { html: string; label: string; pageIndex: number } | null = null
  const pick = (entries: Array<{ page: string }>) => {
    const f = extractFaqSnippet(entries.map((e) => e.page))
    return f ? { ...f, pageIndex: postEntries.indexOf(entries[f.pageIndex] as (typeof postEntries)[number]) } : null
  }
  if (sampleEntry) snippet = pick([sampleEntry])
  if (!snippet) snippet = pick(postEntries.filter((p) => p !== sampleEntry && !bodyStyleCss(p.page).trim()))
  if (!snippet && !sampleEntry) snippet = pick(postEntries)
  if (!snippet && home) {
    const f = extractFaqSnippet([home])
    if (f) snippet = { ...f, pageIndex: -1 }
  }
  const cssEntry =
    sampleEntry ||
    (snippet && snippet.pageIndex >= 0 ? postEntries[snippet.pageIndex] : null) ||
    postEntries.find((p) => bodyStyleCss(p.page).trim()) ||
    postEntries[0] ||
    null
  const cssPage = cssEntry?.page || home
  let suggestedTheme: Partial<UploadTheme> | null = null
  let detail: UploadThemeDetail | null = null
  let usage: ORUsage | null = null
  let faqSummary = ''
  if (cssPage) {
    const themeRules = parseRules(await collectCss(cssPage, cssEntry?.link || target))
    const articleCss = articleOwnCss(parseRules(bodyStyleCss(cssPage)), themeRules)
    const { faqCss, contentCss } = relevantCss(themeRules, snippet ? classTokens(snippet.html) : [], snippet ? faqTags(snippet.html) : [])
    const region = postContentRegion(cssPage)
    const contentClassCss = region ? relevantCss(themeRules, classTokens(region.html.slice(region.openTag.length)).slice(0, 25)).faqCss.slice(0, 6000) : ''
    const computed = computeArticleStyle(cssPage, themeRules)
    if (articleCss) checked.push('CSS ที่บทความฝังมาเอง')
    if (computed) {
      checked.push(
        `คำนวณสีจาก CSS จริงของ ${readableUrl(cssEntry?.link || target)}: ตัวอักษร ${computed.text || '-'}, หัวข้อ ${computed.heading || '-'}, ลิงก์ ${computed.link || '-'}, พื้นหลัง${computed.background ? ` ${computed.background}` : 'โปร่งใส'} (พื้นหน้าเว็บด้านหลัง ${computed.backdrop})`,
      )
    } else {
      warnings.push('หากล่องเนื้อหาบทความในหน้าไม่เจอ — สีมาจากการวิเคราะห์ CSS โดย AI อย่างเดียว ควรเช็คสีอีกครั้ง')
    }
    // บทความแต่ละโพสต์พก CSS คนละชุด — ผลจะตรงกับบทความที่ถูกหยิบมาอ่านเท่านั้น
    const ownCss = uniq(
      posts
        .map((p) => (p.content !== null ? bodyStyleCss(`<body>${p.content}`) : p.page ? bodyStyleCss(p.page) : ''))
        .map((c) => c.replace(/\s+/g, ''))
        .filter(Boolean),
    )
    if (ownCss.length > 1) {
      warnings.push(
        sampleEntry
          ? `บทความบนเว็บนี้ฝัง CSS มาเองคนละชุด หน้าตาแต่ละบทความไม่เหมือนกัน — ใช้หน้าตาจากลิงก์บทความตัวอย่างที่ใส่มา`
          : `บทความบนเว็บนี้ฝัง CSS มาเองคนละชุด หน้าตาแต่ละบทความไม่เหมือนกัน — ผลนี้อ่านจาก ${cssEntry?.link || target} ถ้าต้องการให้เหมือนบทความไหน ใส่ลิงก์บทความนั้นในช่องบทความตัวอย่างแล้วสแกนใหม่`,
      )
    }
    if (snippet && sampleEntry && snippet.pageIndex !== 0) {
      warnings.push(
        snippet.pageIndex === -1
          ? 'บทความตัวอย่างไม่มี FAQ — ใช้รูปแบบ FAQ จากหน้าแรกของเว็บ แต่สีตามบทความตัวอย่าง'
          : 'บทความตัวอย่างไม่มี FAQ — ใช้รูปแบบ FAQ จากบทความอื่นของเว็บเดียวกัน แต่สีตามบทความตัวอย่าง',
      )
    }
    const ai = await analyzeStyle({ faqSnippet: snippet?.html || '', faqLabel: snippet?.label || '', articleCss, faqCss, contentCss, contentClassCss, computed })
    usage = ai.usage
    const t: Partial<UploadTheme> = {}
    if (ai.data) {
      const c = ai.data.colors || {}
      for (const k of ['theme', 'text', 'border', 'accent', 'background'] as const) {
        const v = safeHex(c[k])
        if (v) t[k] = v
      }
      const body = safeFont(ai.data.fonts?.body)
      const heading = safeFont(ai.data.fonts?.heading)
      if (body) t.fontFamily = body
      if (heading) t.headingFont = heading
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
    // ค่าที่คำนวณจาก CSS จริงชนะค่าที่ AI อ่าน — รวมถึงพื้นหลังโปร่งใส ('' = ไม่ใส่พื้น ใช้พื้นของเว็บ)
    if (computed) {
      if (computed.text) t.text = computed.text
      if (computed.heading) t.theme = computed.heading
      if (computed.link) t.accent = computed.link
      t.background = computed.background && computed.background !== '#ffffff' ? computed.background : ''
      t.pageBackground = computed.backdrop
      const bodyFont = safeFont(computed.bodyFont)
      const headingFont = safeFont(computed.headingFont)
      if (bodyFont) t.fontFamily = bodyFont
      if (headingFont && headingFont !== bodyFont) t.headingFont = headingFont
      else if (headingFont === bodyFont) delete t.headingFont
      if (detail) detail = sanitizeThemeDetail(fitDetailToBackdrop(detail, computed)) || null
    }
    suggestedTheme = Object.keys(t).length ? t : null
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
