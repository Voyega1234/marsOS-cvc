// ─────────────────────────────────────────────────────────────────────────────
//  Article Lab — สแกนเว็บไซต์ลูกค้าแล้วเติมค่าให้อัตโนมัติ
//  (คำสั่งเจ้าของ 2026-09-11)
//
//  ขั้นตอน: ดึงหน้าเว็บ → รวบรวมหลักฐาน (สีจาก CSS, ฟอนต์, ข้อความ, โครงเมนู)
//           → ให้ LLM สรุปเป็นชุดค่าที่หน้า Article Lab ใช้ได้ทันที
//
//  ผลลัพธ์เป็น "ข้อเสนอ" เท่านั้น ทีมกดรับแล้วแก้ต่อได้ ระบบไม่บันทึกเอง
//  ใช้ fetcher ของ competitor-gap ซึ่งมี SSRF guard อยู่แล้ว (assertCrawlable)
// ─────────────────────────────────────────────────────────────────────────────

import { askJson } from '@/lib/competitor-gap/ai'
import { orChat } from '@/lib/openrouter'
import { fetchHtml, type FetchResult } from '@/lib/competitor-gap/fetcher'
import { extractPage } from '@/lib/competitor-gap/pageExtract'
import { assertCrawlable, normalizeUrl, toOrigin } from '@/lib/competitor-gap/urls'
import { THAI_FONTS } from '@/lib/articleTheme'

const MAX_PAGES = 6
const MAX_CSS_FILES = 4
const CSS_TIMEOUT_MS = 10_000
const CSS_MAX_BYTES = 800_000

export interface LabScanEvidence {
  pages: Array<{ url: string; title: string; h1: string; words: number }>
  stylesheets: string[]
  topColors: Array<{ hex: string; count: number }>
  fonts: Array<{ name: string; count: number }>
  /** ข้อความตัวอย่างจากเว็บ ใช้เป็นหลักฐานของบริบทธุรกิจ */
  textSample: string
  navLabels: string[]
  /**
   * site = อ่านจากหน้าเว็บตรง
   * web_search = เว็บกันเซิร์ฟเวอร์ (เช่น Cloudflare challenge) จึงใช้ผลค้นหาเว็บแทน — ไม่มีสี/ฟอนต์จาก CSS
   */
  source: 'site' | 'web_search'
}

export interface LabScanSuggestion {
  businessName: string
  industry: string
  /** ธีมบทความ: professional | modern | warm | bold | minimal | editorial */
  articleTheme: string
  accentColor: string
  colors: {
    background: string
    theme: string
    text: string
    border: string
    accent: string
  }
  fonts: { heading: string; body: string }
  projectContext: string
  styleGuide: string
  forbiddenWords: string[]
  /** เหตุผลสั้น ๆ ของแต่ละค่า ให้ทีมตรวจได้ว่าดึงมาจากไหน */
  rationale: string
}

export interface LabScanResult {
  url: string
  suggestion: LabScanSuggestion
  evidence: LabScanEvidence
  warnings: string[]
}

// ── รวบรวมหลักฐานจากเว็บ ─────────────────────────────────────────────────────

const ALLOWED_THEMES = ['professional', 'modern', 'warm', 'bold', 'minimal', 'editorial']

/** หน้าที่มีค่ากับการเข้าใจธุรกิจมากที่สุด เรียงตามลำดับความสำคัญ */
const PRIORITY_PATTERNS = [
  /about|เกี่ยวกับ|about-us/i,
  /service|product|สินค้า|บริการ|treatment/i,
  /contact|ติดต่อ/i,
  /blog|article|บทความ|news/i,
  /faq|คำถาม/i,
]

async function fetchCss(url: string): Promise<string> {
  const guard = await assertCrawlable(url)
  if (!guard.ok) return ''
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(CSS_TIMEOUT_MS),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarsOS-LabScan/1.0)' },
    })
    if (!res.ok) return ''
    const text = await res.text()
    return text.slice(0, CSS_MAX_BYTES)
  } catch {
    return ''
  }
}

function normalizeHex(raw: string): string | null {
  const v = raw.trim().toLowerCase()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v)
  if (hex) {
    const body = hex[1]
    return body.length === 3 ? `#${body.split('').map((c) => c + c).join('')}` : `#${body}`
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(v)
  if (rgb) {
    const to = (n: string) => Math.min(255, parseInt(n, 10)).toString(16).padStart(2, '0')
    return `#${to(rgb[1])}${to(rgb[2])}${to(rgb[3])}`
  }
  return null
}

/** สีที่ไม่ได้บอกอะไรเกี่ยวกับแบรนด์ — ขาว ดำ เทากลาง ๆ */
function isNeutral(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max - min < 18
}

function collectColors(css: string): Map<string, number> {
  const counts = new Map<string, number>()
  const re = /#[0-9a-fA-F]{3,6}\b|rgba?\([^)]*\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css)) !== null) {
    const hex = normalizeHex(m[0])
    if (!hex) continue
    counts.set(hex, (counts.get(hex) ?? 0) + 1)
  }
  return counts
}

function collectFonts(css: string): Map<string, number> {
  const counts = new Map<string, number>()
  const re = /font-family\s*:\s*([^;}"']+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(css)) !== null) {
    for (const part of m[1].split(',')) {
      const name = part.replace(/["']/g, '').trim()
      if (!name) continue
      if (/^(?:inherit|initial|unset|sans-serif|serif|monospace|cursive|fantasy|system-ui|-apple-system|blinkmacsystemfont|ui-[a-z-]+|var\(.*)$/i.test(name)) continue
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }
  return counts
}

function mergeCounts(target: Map<string, number>, src: Map<string, number>) {
  src.forEach((v, k) => target.set(k, (target.get(k) ?? 0) + v))
}

function stylesheetUrls(html: string, base: string): string[] {
  const out: string[] = []
  const re = /<link[^>]+rel=["']?stylesheet["']?[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const href = /href=["']([^"']+)["']/i.exec(m[0])?.[1]
    if (!href) continue
    const abs = normalizeUrl(href, base)
    if (abs && !out.includes(abs)) out.push(abs)
  }
  return out
}

function inlineStyles(html: string): string {
  const out: string[] = []
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) out.push(m[1])
  // style="" attribute ก็เป็นหลักฐานสีของจริงเหมือนกัน
  const attr = /style=["']([^"']+)["']/gi
  while ((m = attr.exec(html)) !== null) out.push(m[1])
  return out.join('\n')
}

function navLabelsOf(html: string): string[] {
  const out: string[] = []
  const navBlocks = html.match(/<nav[\s\S]{0,4000}?<\/nav>/gi) ?? []
  for (const block of navBlocks) {
    const re = />([^<>]{2,40})</g
    let m: RegExpExecArray | null
    while ((m = re.exec(block)) !== null) {
      const t = m[1].replace(/\s+/g, ' ').trim()
      if (t && !out.includes(t) && out.length < 30) out.push(t)
    }
  }
  return out
}

/** status ที่แปลว่าเว็บกันเซิร์ฟเวอร์ ไม่ใช่ว่าหน้าไม่มีอยู่จริง */
const SITE_BLOCK_STATUSES = [401, 403, 429, 503]

/**
 * true เมื่อเว็บปฏิเสธเซิร์ฟเวอร์ (firewall / bot protection / rate limit / ช้าจนหมดเวลา)
 * SSRF guard ที่ปฏิเสธ URL คืน status 0 + error 'blocked: ...' จึงไม่เข้าเงื่อนไขนี้
 */
function isSiteBlock(res: FetchResult): boolean {
  return SITE_BLOCK_STATUSES.includes(res.status) || res.error === 'timeout'
}

/**
 * ดึงหน้าเว็บลูกค้า — ลองแบบปกติก่อน ถ้าโดนกันให้ลองซ้ำหนึ่งครั้งด้วย header แบบเบราว์เซอร์
 * (บางเว็บตีกลับทุก user agent ที่หน้าตาเหมือนบอทด้วย 403)
 */
async function fetchScanPage(url: string): Promise<FetchResult> {
  const first = await fetchHtml(url)
  if (first.ok || !isSiteBlock(first)) return first
  return fetchHtml(url, { browserLike: true })
}

const WEB_SEARCH_MIN_CHARS = 300

function webSearchPrompt(url: string, domain: string): string {
  return `ค้นหาข้อมูลของธุรกิจเจ้าของเว็บไซต์ ${url} (โดเมน ${domain}) แล้วเขียนสรุปภาษาไทยแบบละเอียดตามหัวข้อนี้

1. ชื่อธุรกิจ/แบรนด์ และธุรกิจทำอะไร
2. สินค้า/บริการหลักทีละรายการ (รวมราคา ถ้าเจอ)
3. กลุ่มลูกค้า และพื้นที่/สาขาที่ให้บริการ
4. จุดเด่นที่ธุรกิจโฆษณาเอง — ยกข้อความตรงจากเว็บของธุรกิจในเครื่องหมายคำพูด
5. ช่องทางติดต่อ
6. ใบอนุญาต รางวัล หรือหน่วยงานกำกับที่เกี่ยวข้อง
7. โทนภาษาที่แบรนด์ใช้สื่อสาร

กฎ
- ใช้เฉพาะข้อมูลที่ค้นเจอและเป็นของธุรกิจนี้จริง ระวังธุรกิจที่ชื่อคล้ายกัน
- ห้ามเดา หัวข้อไหนไม่เจอให้เขียนว่า "ไม่พบ"
- ท้ายแต่ละหัวข้อใส่ URL แหล่งที่มา`
}

/**
 * ทางสำรองเมื่อเซิร์ฟเวอร์เปิดเว็บตรงไม่ได้ — ให้ AI ค้นเว็บ (OpenRouter web plugin) แล้วสรุปข้อมูลธุรกิจ
 * ได้เฉพาะข้อความ ไม่ได้สี ฟอนต์ หรือเมนูจาก CSS/HTML จริง
 */
async function collectEvidenceViaWebSearch(
  url: string,
  domain: string,
  reason: string,
): Promise<{ evidence: LabScanEvidence; warnings: string[] }> {
  let res: Awaited<ReturnType<typeof orChat>>
  try {
    res = await orChat({
      trace: 'site_scan_web_search_fallback',
      prompt: webSearchPrompt(url, domain),
      webSearch: true,
      maxTokens: 6_000,
      temperature: 0.2,
      timeoutMs: 120_000,
    })
  } catch (err) {
    throw new Error(`เปิดเว็บไม่ได้ (${reason}) และค้นข้อมูลแทนไม่สำเร็จ: ${(err as Error).message}`)
  }

  const text = res.text.trim()
  if (text.length < WEB_SEARCH_MIN_CHARS) {
    throw new Error(`เปิดเว็บไม่ได้ (${reason}) — เว็บนี้กันการอ่านจากเซิร์ฟเวอร์ และค้นข้อมูลของ ${domain} จากเว็บไม่เจอ`)
  }

  // แหล่งอ้างอิงที่เป็นโดเมนของธุรกิจขึ้นก่อน — URL มักเป็นลิงก์ redirect ของ search provider
  // ส่วน title เป็นชื่อโดเมนจริง จึงเช็คทั้งสองค่า
  const hostOf = (u: string) => {
    try { return new URL(u).hostname.replace(/^www\./, '') } catch { return '' }
  }
  const isOwn = (c: { url: string; title: string }) =>
    hostOf(c.url).endsWith(domain) || c.title.trim().replace(/^www\./, '').endsWith(domain)
  const seen = new Set<string>()
  const cited = [...res.citations]
    .sort((a, b) => Number(isOwn(b)) - Number(isOwn(a)))
    .filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)))
    .slice(0, 8)

  return {
    evidence: {
      source: 'web_search',
      pages: cited.map((c) => ({ url: c.url, title: c.title, h1: '', words: 0 })),
      stylesheets: [],
      topColors: [],
      fonts: [],
      textSample: text.slice(0, 12_000),
      navLabels: [],
    },
    warnings: [
      `เว็บ ${domain} กันการอ่านจากเซิร์ฟเวอร์ (${reason} — มักเป็น Cloudflare) จึงใช้ผลค้นหาเว็บแทน ข้อมูลอาจไม่ครบหรือปนเว็บอื่น ตรวจทุกช่องก่อนบันทึก`,
    ],
  }
}

/** หัวข้อของข้อความหลักฐานใน prompt — บอก AI ให้ชัดว่ามาจากเว็บตรงหรือจากผลค้นหา */
export function evidenceTextHeading(evidence: LabScanEvidence): string {
  return evidence.source === 'web_search'
    ? 'สรุปจากผลค้นหาเว็บ (เซิร์ฟเวอร์เปิดเว็บตรงไม่ได้ ข้อความนี้ไม่ใช่ข้อความจากเว็บโดยตรง — ใช้เฉพาะข้อมูลที่เป็นของธุรกิจนี้ และข้ามหัวข้อที่เขียนว่า "ไม่พบ"):'
    : 'ข้อความจริงจากเว็บ:'
}

export async function collectLabScanEvidence(rawUrl: string): Promise<{ evidence: LabScanEvidence; warnings: string[] }> {
  const warnings: string[] = []
  const start = normalizeUrl(rawUrl, rawUrl) ?? rawUrl
  const origin = toOrigin(start)
  const domain = (() => {
    try { return new URL(start).hostname.replace(/^www\./, '') } catch { return '' }
  })()

  const home = await fetchScanPage(start)
  if (!home.ok || !home.html) {
    if (isSiteBlock(home)) return collectEvidenceViaWebSearch(start, domain, home.error ?? `HTTP ${home.status}`)
    throw new Error(home.error ? `เปิดเว็บไม่ได้: ${home.error}` : 'เปิดเว็บไม่ได้')
  }

  const homePage = extractPage(home.html, home.finalUrl || start, domain)
  const pages: LabScanEvidence['pages'] = [
    { url: home.finalUrl || start, title: homePage.title ?? '', h1: homePage.h1 ?? '', words: homePage.wordCount ?? 0 },
  ]
  const texts: string[] = [homePage.text ?? '']

  // เลือกหน้าถัดไปตามลำดับความสำคัญ ไม่ใช่ลำดับที่เจอในหน้า
  const candidates: string[] = []
  for (const pattern of PRIORITY_PATTERNS) {
    for (const href of homePage.internalHrefs ?? []) {
      if (candidates.length >= MAX_PAGES - 1) break
      if (pattern.test(href) && !candidates.includes(href) && href !== (home.finalUrl || start)) {
        candidates.push(href)
      }
    }
  }

  const cssBundles: string[] = [inlineStyles(home.html)]
  for (const url of candidates) {
    const res = await fetchScanPage(url)
    if (!res.ok || !res.html) {
      warnings.push(`ข้ามหน้า ${url} (${res.error ?? 'เปิดไม่ได้'})`)
      continue
    }
    const p = extractPage(res.html, res.finalUrl || url, domain)
    pages.push({ url: res.finalUrl || url, title: p.title ?? '', h1: p.h1 ?? '', words: p.wordCount ?? 0 })
    texts.push(p.text ?? '')
    cssBundles.push(inlineStyles(res.html))
  }

  const sheets = stylesheetUrls(home.html, origin || start).slice(0, MAX_CSS_FILES)
  for (const sheet of sheets) {
    const css = await fetchCss(sheet)
    if (css) cssBundles.push(css)
    else warnings.push(`อ่าน stylesheet ไม่ได้: ${sheet}`)
  }

  const colorCounts = new Map<string, number>()
  const fontCounts = new Map<string, number>()
  for (const css of cssBundles) {
    mergeCounts(colorCounts, collectColors(css))
    mergeCounts(fontCounts, collectFonts(css))
  }

  const topColors = Array.from(colorCounts.entries())
    .map(([hex, count]) => ({ hex, count }))
    .sort((a, b) => {
      // สีแบรนด์สำคัญกว่าเทา/ขาว/ดำ แม้จะถูกใช้น้อยกว่า
      const an = isNeutral(a.hex) ? 1 : 0
      const bn = isNeutral(b.hex) ? 1 : 0
      if (an !== bn) return an - bn
      return b.count - a.count
    })
    .slice(0, 20)

  const fonts = Array.from(fontCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)

  const textSample = texts.join('\n\n').replace(/\s+/g, ' ').trim().slice(0, 12_000)

  return {
    evidence: {
      source: 'site',
      pages,
      stylesheets: sheets,
      topColors,
      fonts,
      textSample,
      navLabels: navLabelsOf(home.html),
    },
    warnings,
  }
}

// ── ให้ LLM สรุปเป็นค่าที่หน้า Article Lab ใช้ได้ ─────────────────────────────

const SCAN_SYSTEM = `คุณคือ Brand Strategist + Content Strategist ที่อ่านเว็บไซต์ธุรกิจแล้วตั้งค่าระบบเขียนบทความให้

ข้อมูลที่ได้รับ: ข้อความจริงจากเว็บ เมนู สีที่นับได้จาก CSS และชื่อฟอนต์ที่เว็บใช้จริง

ตอบกลับเป็น JSON object เท่านั้น ตามคีย์นี้เป๊ะ:
{
  "businessName": "ชื่อธุรกิจตามที่เว็บระบุ",
  "industry": "อุตสาหกรรม/หมวดธุรกิจ",
  "articleTheme": "หนึ่งใน professional | modern | warm | bold | minimal | editorial",
  "accentColor": "#rrggbb",
  "colors": { "background": "#rrggbb", "theme": "#rrggbb", "text": "#rrggbb", "border": "#rrggbb", "accent": "#rrggbb" },
  "fonts": { "heading": "ชื่อฟอนต์", "body": "ชื่อฟอนต์" },
  "projectContext": "บริบทธุรกิจแบบละเอียด เป็น markdown",
  "styleGuide": "style guide สำหรับเขียนบทความ เป็น markdown",
  "forbiddenWords": ["คำ", "ที่", "ห้ามใช้"],
  "rationale": "สรุปสั้น ๆ ว่าแต่ละค่ามาจากหลักฐานอะไร"
}

กฎ
1. สีทุกค่าต้องเป็น hex 6 หลัก และต้องเลือกจากรายการสีที่นับได้จาก CSS เท่านั้น ห้ามคิดสีใหม่
   ยกเว้นสีตัวอักษร/ขอบที่ไม่มีในรายการ ให้ใช้ #1c1c1c และ #e2e8f0 ตามลำดับ
   พื้นหลังต้องอ่านตัวอักษรออก ถ้าเว็บพื้นขาวให้ใช้ #ffffff
2. fonts ต้องเลือกจากรายการฟอนต์ที่อนุญาตที่ให้ไว้เท่านั้น เลือกตัวที่ใกล้เคียงบุคลิกฟอนต์จริงของเว็บที่สุด
3. projectContext ต้องละเอียด ครอบคลุม: ธุรกิจทำอะไร บริการ/สินค้าหลักทีละรายการ กลุ่มลูกค้า
   จุดขายที่ต่างจากคู่แข่ง พื้นที่/สาขาให้บริการ ช่องทางติดต่อ และข้อเท็จจริงที่ห้ามเขียนผิด
   เขียนจากข้อมูลในเว็บเท่านั้น ห้ามแต่งเติม ถ้าเว็บไม่บอกให้ข้ามหัวข้อนั้นไป
4. styleGuide ต้องเป็นคู่มือเขียนบทความของแบรนด์นี้จริง ๆ ครอบคลุม: โทนเสียง สรรพนามที่ใช้เรียกลูกค้า
   ความยาวย่อหน้า วิธีเรียกชื่อสินค้า/บริการ ศัพท์เฉพาะที่ต้องใช้ให้ตรง วิธีวาง CTA และสิ่งที่ห้ามทำ
5. forbiddenWords ให้คำที่ธุรกิจนี้ใช้แล้วเสี่ยง เช่น คำโฆษณาเกินจริง คำที่ผิดกฎหมายโฆษณาของหมวดธุรกิจนี้
   หรือคำที่แบรนด์ชัดเจนว่าไม่ใช้ ให้ 8-20 คำ เป็นภาษาไทยเป็นหลัก
6. ห้ามใส่ markdown code fence ครอบ JSON`

export async function suggestLabSettings(params: {
  url: string
  evidence: LabScanEvidence
  client?: string
}): Promise<LabScanSuggestion> {
  const user = [
    `เว็บไซต์: ${params.url}`,
    '',
    'หน้าเว็บที่อ่านมา:',
    ...params.evidence.pages.map((p) => `- ${p.url} | title: ${p.title} | h1: ${p.h1} | ${p.words} คำ`),
    '',
    `เมนูหลัก: ${params.evidence.navLabels.join(' · ') || '(ไม่พบ)'}`,
    '',
    'สีที่นับได้จาก CSS (เรียงสีแบรนด์ก่อน แล้วตามจำนวนครั้งที่ใช้):',
    params.evidence.topColors.map((c) => `${c.hex} (${c.count})`).join(', ') || '(ไม่พบ)',
    '',
    'ฟอนต์ที่เว็บใช้จริง:',
    params.evidence.fonts.map((f) => `${f.name} (${f.count})`).join(', ') || '(ไม่พบ)',
    '',
    `ฟอนต์ที่อนุญาตให้เลือก (ต้องเลือกจากรายการนี้เท่านั้น): ${THAI_FONTS.join(', ')}`,
    '',
    evidenceTextHeading(params.evidence),
    params.evidence.textSample || '(ไม่มีข้อความ)',
  ].join('\n')

  const res = await askJson<LabScanSuggestion>({
    trace: 'article_lab_site_scan',
    system: SCAN_SYSTEM,
    user,
    maxTokens: 12_000,
    temperature: 0.3,
    timeoutMs: 180_000,
  })

  if (!res.data) throw new Error(res.error ?? 'AI สรุปผลไม่สำเร็จ')
  return sanitizeSuggestion(res.data, params.evidence)
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/

function pickHex(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback
  const n = normalizeHex(v)
  return n && HEX_RE.test(n) ? n : fallback
}

function pickFont(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback
  const match = THAI_FONTS.find((f) => f.toLowerCase() === v.trim().toLowerCase())
  return match ?? fallback
}

/** กัน LLM คืนค่าที่หน้า Article Lab ใช้ไม่ได้ (สีเพี้ยน ฟอนต์นอกรายการ ธีมไม่มีจริง) */
export function sanitizeSuggestion(raw: LabScanSuggestion, evidence: LabScanEvidence): LabScanSuggestion {
  const brandColor = evidence.topColors.find((c) => !isNeutral(c.hex))?.hex ?? '#2563eb'
  const theme = typeof raw.articleTheme === 'string' && ALLOWED_THEMES.includes(raw.articleTheme.trim().toLowerCase())
    ? raw.articleTheme.trim().toLowerCase()
    : 'professional'

  const colors = raw.colors ?? ({} as LabScanSuggestion['colors'])
  const themeColor = pickHex(colors.theme, brandColor)

  return {
    businessName: String(raw.businessName ?? '').trim().slice(0, 200),
    industry: String(raw.industry ?? '').trim().slice(0, 200),
    articleTheme: theme,
    accentColor: pickHex(raw.accentColor, themeColor),
    colors: {
      background: pickHex(colors.background, '#ffffff'),
      theme: themeColor,
      text: pickHex(colors.text, '#1c1c1c'),
      border: pickHex(colors.border, '#e2e8f0'),
      accent: pickHex(colors.accent, themeColor),
    },
    fonts: {
      heading: pickFont(raw.fonts?.heading, 'Sarabun'),
      body: pickFont(raw.fonts?.body, 'Sarabun'),
    },
    projectContext: String(raw.projectContext ?? '').trim(),
    styleGuide: String(raw.styleGuide ?? '').trim(),
    forbiddenWords: Array.isArray(raw.forbiddenWords)
      ? raw.forbiddenWords.map((w) => String(w).trim()).filter(Boolean).slice(0, 60)
      : [],
    rationale: String(raw.rationale ?? '').trim(),
  }
}

export async function runLabScan(rawUrl: string, client?: string): Promise<LabScanResult> {
  const { evidence, warnings } = await collectLabScanEvidence(rawUrl)
  const suggestion = await suggestLabSettings({ url: rawUrl, evidence, client })
  if (evidence.source === 'web_search') {
    warnings.push('อ่านสีและฟอนต์จาก CSS ของเว็บไม่ได้ — ค่าสี/ฟอนต์เป็นค่าตั้งต้น ปรับเองให้ตรงแบรนด์')
  }
  return { url: rawUrl, suggestion, evidence, warnings }
}
