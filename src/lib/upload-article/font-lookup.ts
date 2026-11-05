/**
 * หาไฟล์ฟอนต์ที่บทความใช้แต่ CSS ของเว็บไม่ได้ประกาศไว้ให้เห็น ไม่ใช้ AI ไม่เก็บไฟล์ไว้ที่ระบบ
 * ลำดับ: <link>/@import ของ Google Fonts บนหน้า → @import อื่น → ค้นชื่อใน Google Fonts → ค้นชื่อใน Fontsource
 * (Fontsource รันเฉพาะฟอนต์ที่ยังขาดหลังทุกขั้นก่อนหน้า · ไฟล์ชี้ไปที่ jsDelivr ไม่โหลดมาเก็บ)
 * ฟอนต์ที่เว็บมีไฟล์ของตัวเองอยู่แล้วจะไม่ถูกแตะ และไม่มีการเรียกเน็ตเลย
 */
import { parseFontFaces, absolutizeFontUrls, fontFaceBlocks } from './article-style-scan'
import { articleFontStacks, FONT_FACE_MAX, fontCoverage, fontFamiliesIn } from './font-faces'
import type { UploadArticleStyle, UploadFontFace } from './types'

const MAX_LOOKUPS = 6
const MAX_IMPORTS = 6
/** เวลารวมของการหาฟอนต์ทั้งหมด — หมดแล้วคืนเท่าที่ได้ ไม่ทำให้สแกนล้ม */
export const FONT_LOOKUP_DEADLINE_MS = 20_000

const GOOGLE_CSS_RE = /https:\/\/fonts\.googleapis\.com\/css2?\?[^"'\s)<>]+/gi
const IMPORT_RE = /@import\s+url\(\s*"(https:\/\/[^"]+)"\s*\)/gi
// ชื่อที่ Google Fonts มีได้ — ชื่อแบบ sukhumvit-light เป็นฟอนต์ของเว็บเอง ค้นไปก็ไม่เจอ
const GOOGLE_NAME_RE = /^[A-Za-z0-9 ]{2,60}$/
// ชื่อที่ลองใน Fontsource — ยอมให้มีขีด (ได้ 404 เฉยๆ) แล้วกันจับผิดด้วยการเทียบชื่อ family
const FONTSOURCE_NAME_RE = /^[A-Za-z0-9 -]{2,60}$/
const FONTSOURCE_ID_RE = /^[a-z0-9-]+$/
const UNICODE_RANGE_RE = /^[Uu0-9A-Fa-f+,? -]+$/
const normFamily = (s: string) => s.toLowerCase().replace(/[\s\-_]+/g, '')
const SKIP_IMPORT_RE = /font-awesome|fontawesome|dashicons|eicons/i

/** เก็บเฉพาะชุดอักษรไทย + ละติน ไทยมาก่อน ไม่ให้เพดานจำนวนไฟล์ตัดไทยทิ้ง */
export function keepReadingSubsets(css: string): string {
  const blocks = fontFaceBlocks(css).map((b) => ({
    text: css.slice(b.start, b.end),
    // ชื่อชุดอักษรอยู่ในคอมเมนต์ก่อนบล็อก เช่น /* thai */
    name: (/\/\*\s*([\w[\]-]+)\s*\*\/\s*$/.exec(css.slice(Math.max(0, b.start - 100), b.start))?.[1] || '').toLowerCase(),
  }))
  const of = (name: string) => blocks.filter((m) => m.name === name)
  const keep = [...of('thai'), ...of('latin')]
  return (keep.length ? keep : blocks).map((m) => m.text).join('\n')
}

/** สร้าง @font-face จาก metadata ของ Fontsource (เนื้อหาไม่น่าเชื่อถือ — ตรวจทุกช่อง) · คืน null ถ้าไม่ตรง */
export function fontsourceFaceCss(wanted: string, body: string | null, used: number[]): string | null {
  if (!body || !FONTSOURCE_NAME_RE.test(wanted)) return null
  const id = wanted.trim().toLowerCase().replace(/\s+/g, '-')
  if (!FONTSOURCE_ID_RE.test(id)) return null
  let meta: unknown
  try {
    meta = JSON.parse(body)
  } catch {
    return null
  }
  if (!meta || typeof meta !== 'object') return null
  const m = meta as { family?: unknown; subsets?: unknown; weights?: unknown; unicodeRange?: unknown }
  // ชื่อต้องตรงจริง กัน sukhumvit-light ไปจับ Sukhumvit
  if (typeof m.family !== 'string' || normFamily(m.family) !== normFamily(wanted)) return null
  const subsets = Array.isArray(m.subsets) ? m.subsets : []
  const picked = ['thai', 'latin'].filter((s) => subsets.includes(s))
  const avail = (Array.isArray(m.weights) ? m.weights : []).filter((w): w is number => Number.isInteger(w) && w >= 100 && w <= 900)
  if (!picked.length || !avail.length) return null
  const want = used.length ? used : [400]
  const hit = Array.from(new Set(want.filter((w) => avail.includes(w))))
  const nearest = (w: number) => avail.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a))
  const weights = (hit.length ? hit : Array.from(new Set(want.map(nearest)))).sort((a, b) => a - b)
  const ranges = m.unicodeRange && typeof m.unicodeRange === 'object' ? (m.unicodeRange as Record<string, unknown>) : {}
  const name = wanted.trim()
  const out: string[] = []
  for (const sub of picked) {
    const r = ranges[sub]
    const range = typeof r === 'string' && r.length <= 2000 && UNICODE_RANGE_RE.test(r) ? ` unicode-range: ${r};` : ''
    for (const w of weights) {
      out.push(`/* ${sub} */\n@font-face { font-family: '${name}'; font-style: normal; font-weight: ${w}; src: url(https://cdn.jsdelivr.net/fontsource/fonts/${id}@latest/${sub}-${w}-normal.woff2) format('woff2');${range} }`)
    }
  }
  return out.join('\n')
}

export function googleFontUrl(family: string, weights: number[]): string {
  const name = family.trim().replace(/\s+/g, '+')
  const list = Array.from(new Set(weights)).sort((a, b) => a - b)
  const tuple = list.length ? `:wght@${list.join(';')}` : ''
  return `https://fonts.googleapis.com/css2?family=${name}${tuple}&display=swap`
}

function sameFace(a: UploadFontFace, b: UploadFontFace): boolean {
  return a.family.toLowerCase() === b.family.toLowerCase() && (a.weight || '') === (b.weight || '') && a.url === b.url
}

export async function findMissingFontFaces(input: {
  article: UploadArticleStyle
  page: string
  rawCss: string
  fetchCss: (url: string) => Promise<string | null>
  deadlineMs?: number
}): Promise<{ faces: UploadFontFace[] | undefined; missing: string[] }> {
  const { article, page, rawCss, fetchCss } = input
  const stacks = articleFontStacks(article)
  const weights = [article.p?.fontWeight, article.h2?.fontWeight, article.h3?.fontWeight, article.h4?.fontWeight, article.li?.fontWeight, article.strong?.fontWeight]
  const used = weights.filter((w): w is number => typeof w === 'number')
  const own = article.fontFaces
  const need = () => fontCoverage(stacks, faces).filter((c) => c.status === 'missing').map((c) => c.family)

  let faces: UploadFontFace[] | undefined = own
  if (!fontFamiliesIn(stacks).length || !need().length) return { faces, missing: [] }

  const deadline = Date.now() + (input.deadlineMs ?? FONT_LOOKUP_DEADLINE_MS)
  const safeFetch = async (url: string) => {
    const left = deadline - Date.now()
    if (left <= 0) return null
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        fetchCss(url),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), left)
        }),
      ])
    } catch {
      return null
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
  const add = (css: string | null, wanted: string[]) => {
    if (!css) return
    const found = parseFontFaces(css, wanted, used)
    const room = FONT_FACE_MAX - (faces?.length || 0)
    if (room <= 0 || !found.length) return
    const fresh = found.filter((f) => !(faces || []).some((x) => sameFace(x, f))).slice(0, room)
    if (fresh.length) faces = [...(faces || []), ...fresh]
  }

  // Google Fonts ที่หน้าโหลดจริง — น้ำหนักตรงตามที่เว็บเลือกไว้
  const decoded = `${page}\n${rawCss}`.replace(/&amp;/g, '&').replace(/&#0?38;/g, '&')
  const linked = Array.from(new Set(Array.from(decoded.matchAll(GOOGLE_CSS_RE), (m) => m[0]))).slice(0, MAX_IMPORTS)
  const linkedCss = await Promise.all(linked.map(safeFetch))
  for (const css of linkedCss) add(css && keepReadingSubsets(css), need())

  // @import ไฟล์อื่น — เอาเฉพาะ @font-face ไม่ปน cascade ของบทความ
  if (need().length) {
    const imports = Array.from(new Set(Array.from(rawCss.matchAll(IMPORT_RE), (m) => m[1])))
      .filter((u) => !/fonts\.googleapis\.com/i.test(u) && !SKIP_IMPORT_RE.test(u))
      .slice(0, MAX_IMPORTS)
    const files = await Promise.all(imports.map(async (u) => {
      const css = await safeFetch(u)
      return css ? absolutizeFontUrls(css, u) : null
    }))
    for (const css of files) add(css, need())
  }

  // สุดท้าย: ค้นชื่อใน Google Fonts · 400 = ไม่มีฟอนต์นี้หรือไม่มีน้ำหนักนี้ ลองแบบไม่ระบุน้ำหนักอีกครั้ง
  const byName = need().filter((n) => GOOGLE_NAME_RE.test(n)).slice(0, MAX_LOOKUPS)
  const lookedUp = await Promise.all(byName.map(async (family) => {
    const css = (await safeFetch(googleFontUrl(family, used))) || (used.length ? await safeFetch(googleFontUrl(family, [])) : null)
    return { family, css }
  }))
  for (const { family, css } of lookedUp) add(css && keepReadingSubsets(css), [family])

  // ขั้นสุดท้ายจริง: Fontsource (ฟรี ไม่ใช้ AI) เฉพาะที่ยังขาด
  const byFontsource = need().filter((n) => FONTSOURCE_NAME_RE.test(n)).slice(0, MAX_LOOKUPS)
  if (byFontsource.length) {
    const metas = await Promise.all(byFontsource.map(async (family) => {
      const id = family.trim().toLowerCase().replace(/\s+/g, '-')
      if (!FONTSOURCE_ID_RE.test(id)) return { family, css: null }
      return { family, css: fontsourceFaceCss(family, await safeFetch(`https://api.fontsource.org/v1/fonts/${id}`), used) }
    }))
    for (const { family, css } of metas) add(css, [family])
  }

  return { faces, missing: need() }
}
