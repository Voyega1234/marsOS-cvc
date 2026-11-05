/**
 * ฟอนต์จริงของเว็บลูกค้า (จากการสแกน) สำหรับพรีวิวในระบบและไฟล์ดาวน์โหลด
 * ตอน push ไม่ใช้ไฟล์นี้ เว็บลูกค้ามีฟอนต์ของตัวเองอยู่แล้ว
 * ไม่มี dependency ฝั่งเซิร์ฟเวอร์ — หน้า client import ได้
 */
import type { UploadArticleStyle, UploadFontFace } from './types'

export const FONT_FILE_RE = /\.(?:woff2|woff|ttf|otf)$/i
export const MAX_FONT_BYTES = 2_500_000
/** งบรวมของฟอนต์ที่ฝังในไฟล์ HTML ดาวน์โหลด */
export const INLINE_FONT_BUDGET = 6_000_000

const FAMILY_RE = /^[\w À-ɏ฀-๿-]{1,80}$/
const URL_RE = /^https:\/\/[^\s"'()<>{};\\]+$/
const WEIGHT_RE = /^(?:normal|bold|\d{1,3}(?:\s+\d{1,3})?)$/
const STYLE_RE = /^(?:normal|italic|oblique)$/
const FORMAT_RE = /^[\w-]{1,20}$/
const RANGE_RE = /^[uU+0-9a-fA-F?,\s-]{1,1000}$/

export function proxiedFontUrl(url: string): string {
  return `/api/font-proxy?u=${encodeURIComponent(url)}`
}

/** ดูชนิดฟอนต์จาก 4 ไบต์แรก — null = ไม่ใช่ฟอนต์ */
export function fontMimeFromBytes(b: Uint8Array): string | null {
  if (b.length < 4) return null
  const tag = String.fromCharCode(b[0], b[1], b[2], b[3])
  if (tag === 'wOF2') return 'font/woff2'
  if (tag === 'wOFF') return 'font/woff'
  if (tag === 'OTTO') return 'font/otf'
  if (tag === 'true' || (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0)) return 'font/ttf'
  return null
}

function validFace(f: UploadFontFace): boolean {
  return !!f && typeof f.family === 'string' && typeof f.url === 'string' && FAMILY_RE.test(f.family) && URL_RE.test(f.url)
}

/** สร้าง @font-face จากรายการที่สแกนได้ · mapUrl = แปลง URL ก่อนใส่ CSS · แถวที่ไม่ตรงรูปแบบถูกข้าม */
export function fontFaceCss(faces: UploadFontFace[] | undefined, mapUrl: (url: string) => string = proxiedFontUrl): string {
  if (!faces?.length) return ''
  return faces
    .filter(validFace)
    .map((f) => {
      const parts = [`font-family:"${f.family.trim()}"`, `src:url("${mapUrl(f.url)}")${f.format && FORMAT_RE.test(f.format) ? ` format("${f.format}")` : ''}`]
      if (f.weight && WEIGHT_RE.test(f.weight)) parts.push(`font-weight:${f.weight}`)
      if (f.style && STYLE_RE.test(f.style)) parts.push(`font-style:${f.style}`)
      if (f.unicodeRange && RANGE_RE.test(f.unicodeRange)) parts.push(`unicode-range:${f.unicodeRange}`)
      parts.push('font-display:swap')
      return `@font-face{${parts.join(';')}}`
    })
    .join('')
}

/** เลือกเฉพาะ family ที่ CSS ใช้จริง กันไฟล์ดาวน์โหลดบวมจากฟอนต์ที่เว็บประกาศไว้แต่บทความไม่ใช้ */
export function usedFontFaces(faces: UploadFontFace[] | undefined, stacks: Array<string | undefined>): UploadFontFace[] {
  if (!faces?.length) return []
  const used = new Set<string>()
  for (const stack of stacks) {
    for (const part of (stack || '').split(',')) {
      const name = part.replace(/['"]/g, '').trim().toLowerCase()
      if (name) used.add(name)
    }
  }
  return faces.filter((f) => used.has((f.family || '').trim().toLowerCase()))
}

/** เพดานจำนวนไฟล์ฟอนต์ต่อธีม: ของเว็บเองไม่เกิน 24 + ที่หาเพิ่มจาก Google Fonts */
export const FONT_FACE_MAX = 40

// ฟอนต์ที่มีในเครื่องผู้อ่านอยู่แล้ว ไม่ต้องมีไฟล์
const SYSTEM_FONT_RE = /^(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|ui-rounded|emoji|math|inherit|initial|unset|revert|-apple-system|blinkmacsystemfont|segoe ui|segoe ui emoji|apple color emoji|noto color emoji|helvetica|helvetica neue|arial|arial black|tahoma|verdana|georgia|times|times new roman|courier|courier new|trebuchet ms|impact|lucida grande|leelawadee|leelawadee ui|thonburi|sukhumvit set|iowan old style|palatino|palatino linotype|book antiqua|urw palladio l|p052|cambria|calibri|candara|constantia|corbel|consolas|menlo|monaco|sf pro|sf pro text|sf pro display|sf mono)$/i
// ตัวสำรองอัตโนมัติของ Next.js/next-font ไม่มีไฟล์ของตัวเอง
const GENERATED_FALLBACK_RE = /(?:^|[\s_-])fallback(?:[\s_-].*)?$/i

const GOOGLE_FONT_HOST_RE = /^https:\/\/fonts\.gstatic\.com\//i

export type FontStatus = 'site' | 'google' | 'missing'

export interface FontCoverage {
  family: string
  status: FontStatus
  files: number
}

/** ชื่อฟอนต์ที่ต้องมีไฟล์ เรียงตามที่เจอ ไม่นับฟอนต์ระบบ */
export function fontFamiliesIn(stacks: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const stack of stacks) {
    for (const part of (stack || '').split(',')) {
      const name = part.replace(/['"]/g, '').trim()
      const key = name.toLowerCase()
      // var() ที่แทนค่าไม่ได้ ไม่ใช่ชื่อฟอนต์
      if (!name || name.includes('(') || seen.has(key) || SYSTEM_FONT_RE.test(name) || GENERATED_FALLBACK_RE.test(name)) continue
      seen.add(key)
      out.push(name)
    }
  }
  return out
}

/** ไฟล์นี้ font-proxy ส่งให้พรีวิวได้จริงไหม (URL ต้องลงท้ายด้วยนามสกุลฟอนต์) */
/** ตัวแรกของแต่ละ stack ที่ต้องโหลดไฟล์ — ตัวที่เว็บตั้งใจใช้จริง */
export function primaryFontFamilies(stacks: Array<string | undefined>): string[] {
  return fontFamiliesIn(stacks.map((s) => (s ? fontFamiliesIn([s])[0] : undefined)))
}

export function fontFaceLoadable(f: UploadFontFace): boolean {
  if (!validFace(f)) return false
  try {
    return FONT_FILE_RE.test(new URL(f.url).pathname)
  } catch {
    return false
  }
}

/** stack ฟอนต์ทุกส่วนของบทความ — เนื้อหามาก่อนเพราะเป็นตัวที่เห็นมากสุด */
export function articleFontStacks(a: UploadArticleStyle | undefined): Array<string | undefined> {
  if (!a) return []
  return [a.p?.fontFamily, a.h2?.fontFamily, a.h3?.fontFamily, a.h4?.fontFamily, a.li?.fontFamily, a.strong?.fontFamily]
}

/** แต่ละฟอนต์ที่บทความใช้ มีไฟล์ให้พรีวิวไหม และมาจากไหน */
export function fontCoverage(stacks: Array<string | undefined>, faces: UploadFontFace[] | undefined): FontCoverage[] {
  return fontFamiliesIn(stacks).map((family) => {
    const mine = (faces || []).filter((f) => (f.family || '').trim().toLowerCase() === family.toLowerCase() && fontFaceLoadable(f))
    if (!mine.length) return { family, status: 'missing' as const, files: 0 }
    return { family, status: mine.every((f) => GOOGLE_FONT_HOST_RE.test(f.url)) ? ('google' as const) : ('site' as const), files: mine.length }
  })
}

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  const STEP = 0x8000
  for (let i = 0; i < bytes.length; i += STEP) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + STEP)))
  }
  return btoa(bin)
}

/** เวลารวมสูงสุดของการโหลดฟอนต์ไปฝังในไฟล์ดาวน์โหลด */
export const INLINE_FONT_DEADLINE_MS = 30_000
const INLINE_FONT_CONCURRENCY = 4

/**
 * ฝังฟอนต์ลง CSS สำหรับไฟล์ HTML ดาวน์โหลด (ฝั่งเบราว์เซอร์เท่านั้น) — ไฟล์เปิดเครื่องไหนก็ได้ฟอนต์เดิม
 * โหลดไม่ได้หรือเกินงบ = ข้าม ฟอนต์ตัวนั้นถอยไปตัวถัดไปใน stack ไม่ทำให้การดาวน์โหลดล้ม
 * งบนับความยาว base64 จริง · โหลดทีละ 4 ไฟล์ · หมดเวลา = หยุดโหลดเพิ่มและนับที่เหลือเป็น skipped
 */
export async function inlineFontFaceCss(
  faces: UploadFontFace[],
  load: (url: string) => Promise<Uint8Array | null> = async (url) => {
    const r = await fetch(proxiedFontUrl(url), { signal: AbortSignal.timeout(10_000) })
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null
  },
  budget = INLINE_FONT_BUDGET,
  opts: { deadlineMs?: number } = {},
): Promise<{ css: string; skipped: number }> {
  const deadline = Date.now() + (opts.deadlineMs ?? INLINE_FONT_DEADLINE_MS)
  const data = new Map<string, string>()
  let used = 0
  let skipped = 0
  const urls: string[] = []
  for (const f of faces.filter(validFace)) if (!urls.includes(f.url)) urls.push(f.url)
  for (let i = 0; i < urls.length; i += INLINE_FONT_CONCURRENCY) {
    if (Date.now() >= deadline) {
      skipped += urls.length - i
      break
    }
    const batch = urls.slice(i, i + INLINE_FONT_CONCURRENCY)
    const loaded = await Promise.all(batch.map((u) => load(u).catch(() => null)))
    batch.forEach((u, k) => {
      const bytes = loaded[k]
      const mime = bytes && fontMimeFromBytes(bytes)
      if (!bytes || !mime) {
        skipped++
        return
      }
      const uri = `data:${mime};base64,${toBase64(bytes)}`
      if (used + uri.length > budget) {
        skipped++
        return
      }
      used += uri.length
      data.set(u, uri)
    })
  }
  const kept = faces.filter((f) => data.has(f.url))
  return { css: fontFaceCss(kept, (u) => data.get(u) as string), skipped }
}

/** ฟอนต์ที่ไฟล์ HTML ดาวน์โหลดควรฝัง — ดูจาก family ที่ใช้ในหน้าตาบทความ */
export async function exportFontCss(article: Parameters<typeof exportFontCssDetailed>[0]): Promise<string> {
  return (await exportFontCssDetailed(article)).css
}

/** เหมือน exportFontCss แต่บอกด้วยว่าข้ามไปกี่ไฟล์ (skipped > 0 = ไฟล์ดาวน์โหลดมีฟอนต์ไม่ครบ) */
export async function exportFontCssDetailed(article: {
  fontFaces?: UploadFontFace[]
  p?: { fontFamily?: string }
  h2?: { fontFamily?: string }
  h3?: { fontFamily?: string }
  h4?: { fontFamily?: string }
  li?: { fontFamily?: string }
  strong?: { fontFamily?: string }
} | undefined): Promise<{ css: string; skipped: number }> {
  if (!article?.fontFaces?.length) return { css: '', skipped: 0 }
  const faces = usedFontFaces(article.fontFaces, [article.p, article.h2, article.h3, article.h4, article.li, article.strong].map((t) => t?.fontFamily))
  return inlineFontFaceCss(faces)
}
