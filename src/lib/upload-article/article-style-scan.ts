// ─── วัดหน้าตาบทความละเอียดจาก CSS จริงของเว็บ (ไม่ใช้ AI) ───────────────────────────────────
// ขนาด/น้ำหนัก/ระยะบรรทัด/ระยะห่าง, กรอบรายการ, เส้นเหนือหัวข้อ, สี marker, กล่องเนื้อหา, ไฟล์ฟอนต์,
// โครงบทความ (สารบัญ/กล่องสรุป/FAQ/สรุปก่อน FAQ) และรายการแหล่งอ้างอิงที่เว็บเคยใช้
// ค่าที่ยืดตามจอ (clamp/vw) เก็บตามจริงให้บทความย่อขยายเหมือนเว็บ ส่วน em/rem/% แปลงเป็น px เพราะฐานต่างกันบนหน้าเรา
// ข้อจำกัดเดียวกับ css-cascade: กฎแบบ sibling/attribute/สถานะถูกข้าม, ค่ามือถือใน @media ไม่ถูกเก็บ

import { HTMLElement, parse as parseHtml } from 'node-html-parser'
import { TAKEAWAYS_HEADING_RE, countLatinThaiBoundaries } from '@/lib/article-structure'
import { CssCascade, openChainAt, parseOpenTag, splitTop, toHex, type CssEl, type CssRule } from './css-cascade'
import { cleanReferenceUrl } from './references'
import type {
  UploadArticleStructure,
  UploadArticleStyle,
  UploadBoxStyle,
  UploadFontFace,
  UploadHeadingOrnament,
  UploadReference,
  UploadTextStyle,
} from './types'

const ARTICLE_WATCHED =
  /^(?:color$|background|font|line-height$|letter-spacing$|margin|padding|border|list-style|width$|max-width$|height$|display$|position$|content$|text-decoration|--)/

/** จอที่ใช้คำนวณค่า em/clamp ตอนสแกน */
const VW = 1440
const VH = 900

interface Cascades {
  base: CssCascade
  before: CssCascade
  marker: CssCascade
  rootPx: number
}

export interface ArticleRegion {
  start: number
  end: number
  openTag: string
}

// ── ความยาว ─────────────────────────────────────────────────────────────────

/** คำนวณค่าความยาวเป็น px (รองรับ clamp/min/max/calc) — อ่านไม่ออก = null */
export function evalLength(raw: string, ctx: { em: number; rem: number; percent?: number }): number | null {
  const s = raw.trim().toLowerCase()
  let i = 0
  const ws = () => {
    while (i < s.length && /\s/.test(s[i])) i++
  }
  const factor = (): number => {
    ws()
    if (s[i] === '(') {
      i++
      const v = expr()
      ws()
      if (s[i++] !== ')') throw new Error('paren')
      return v
    }
    const fn = /^(clamp|min|max|calc)\(/.exec(s.slice(i))
    if (fn) {
      i += fn[0].length
      const args = [expr()]
      ws()
      while (s[i] === ',') {
        i++
        args.push(expr())
        ws()
      }
      if (s[i++] !== ')') throw new Error('paren')
      if (fn[1] === 'calc') return args[0]
      if (fn[1] === 'min') return Math.min(...args)
      if (fn[1] === 'max') return Math.max(...args)
      if (args.length !== 3) throw new Error('clamp')
      return Math.max(args[0], Math.min(args[1], args[2]))
    }
    const m = /^[-+]?(?:\d+\.?\d*|\.\d+)(px|em|rem|vw|vh|%)?/.exec(s.slice(i))
    if (!m) throw new Error('num')
    i += m[0].length
    const n = parseFloat(m[0])
    switch (m[1]) {
      case 'em':
        return n * ctx.em
      case 'rem':
        return n * ctx.rem
      case 'vw':
        return (n * VW) / 100
      case 'vh':
        return (n * VH) / 100
      case '%':
        if (ctx.percent === undefined) throw new Error('percent')
        return (n * ctx.percent) / 100
      default:
        return n
    }
  }
  const term = (): number => {
    let v = factor()
    for (;;) {
      ws()
      const c = s[i]
      if (c !== '*' && c !== '/') return v
      i++
      const r = factor()
      v = c === '*' ? v * r : v / r
    }
  }
  const expr = (): number => {
    let v = term()
    for (;;) {
      ws()
      const c = s[i]
      if (c !== '+' && c !== '-') return v
      i++
      const r = term()
      v = c === '+' ? v + r : v - r
    }
  }
  try {
    const v = expr()
    ws()
    return i === s.length && Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

const round = (n: number) => String(Math.round(n * 100) / 100)

const isRelative = (v: string) => /(?:\d|\.)\s*(?:em|rem|%)/.test(v)

const KEYWORD_LEN = /^(?:inherit|initial|unset|revert|normal|none)$/

/** ค่าความยาวที่เก็บได้ — ยืดตามจอเก็บตามจริง, ค่าที่อิงฐานตัวอักษรแปลงเป็น px */
function normLen(raw: string | undefined, em: number, rem: number): string | undefined {
  const v = raw?.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!v || KEYWORD_LEN.test(v)) return undefined
  if (v === 'auto') return v
  const px = evalLength(v, { em, rem })
  if (px === null) return undefined
  if (px === 0) return '0'
  return isRelative(v) ? `${round(px)}px` : v
}

/** แยกค่าตามช่องว่างระดับบนสุด (ไม่ตัดในวงเล็บ) */
function splitSpace(value: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const c of value.trim()) {
    if (c === '(') depth++
    else if (c === ')') depth--
    if (/\s/.test(c) && depth === 0) {
      if (cur) out.push(cur)
      cur = ''
    } else cur += c
  }
  if (cur) out.push(cur)
  return out
}

// ── สี ──────────────────────────────────────────────────────────────────────

/** เก็บสีตามจริงรวมความโปร่งใส — rgba(166,135,86,.13) ต้องไม่กลายเป็นสีทึบ */
function cssColor(raw: string | undefined): string | undefined {
  const v = raw?.trim().toLowerCase()
  if (!v || /^(?:inherit|initial|unset|revert|currentcolor|none)$/.test(v)) return undefined
  if (v === 'transparent') return v
  if (/^#[0-9a-f]{3,8}$/.test(v)) return v
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(v)
  if (m) return m[4] !== undefined ? `rgba(${m[1]},${m[2]},${m[3]},${m[4]})` : `rgb(${m[1]},${m[2]},${m[3]})`
  return toHex(v) ?? undefined
}

/** สีตัวแรกใน background shorthand — ไล่เฉดหรือรูปถือว่าไม่มีสีพื้นเดียว */
function firstColorRaw(raw: string | undefined): string | undefined {
  if (!raw || /gradient\(|url\(/i.test(raw)) return undefined
  const direct = cssColor(raw)
  if (direct) return direct
  for (const t of raw.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b[a-z]+\b/gi) || []) {
    const c = cssColor(t)
    if (c) return c
  }
  return undefined
}

// ── อ่านค่าจาก cascade ──────────────────────────────────────────────────────

function inheritedAny(cx: Cascades, chain: CssEl[], props: string[]): { prop: string; value: string; at: number } | null {
  for (let i = chain.length; i > 0; i--) {
    const sub = chain.slice(0, i)
    const win = cx.base.cascaded(sub, props)
    if (!win) continue
    if (!win.value || /^(?:inherit|unset)$/i.test(win.value)) continue
    return { ...win, at: i - 1 }
  }
  return null
}

/** font: italic 700 16px/1.5 Arial — คืนส่วนที่ต้องใช้ */
function parseFontShorthand(value: string): { size?: string; lineHeight?: string; weight?: string; family?: string } {
  const m = /^(.*?)((?:\d|\.)[^\s/]*)(?:\s*\/\s*([^\s]+))?\s+(.+)$/.exec(value.trim())
  if (!m) return {}
  const weight = /\b(bold|normal|[1-9]00)\b/i.exec(m[1])?.[1]
  return { size: m[2], lineHeight: m[3], weight, family: m[4] }
}

function fontSizePx(cx: Cascades, chain: CssEl[]): number {
  for (let i = chain.length; i > 0; i--) {
    const win = cx.base.cascaded(chain.slice(0, i), ['font-size', 'font'])
    if (!win) continue
    const raw = win.prop === 'font' ? parseFontShorthand(win.value).size : win.value
    if (!raw || /^(?:inherit|unset)$/i.test(raw)) continue
    const parent = i > 1 ? fontSizePx(cx, chain.slice(0, i - 1)) : 16
    const px = evalLength(raw, { em: parent, rem: cx.rootPx, percent: parent })
    // font-size:0 เป็นเทคนิคจัดช่องไฟของ layout ไม่ใช่ขนาดตัวอักษร
    if (px !== null && px > 0) return px
  }
  return 16
}

function rawFontSize(cx: Cascades, chain: CssEl[]): string | undefined {
  for (let i = chain.length; i > 0; i--) {
    const win = cx.base.cascaded(chain.slice(0, i), ['font-size', 'font'])
    if (!win) continue
    const raw = win.prop === 'font' ? parseFontShorthand(win.value).size : win.value
    if (!raw || /^(?:inherit|unset)$/i.test(raw)) continue
    const v = raw.trim().toLowerCase().replace(/\s+/g, ' ')
    const at = evalLength(v, { em: 16, rem: 16, percent: 16 })
    if (at === null || at <= 0) continue
    return isRelative(v) ? `${round(fontSizePx(cx, chain))}px` : v
  }
  return undefined
}

function fontWeightOf(cx: Cascades, chain: CssEl[], ownOnly: boolean): number | undefined {
  const parse = (v: string | undefined) => {
    if (!v) return undefined
    const k = v.trim().toLowerCase()
    if (k === 'normal') return 400
    if (k === 'bold') return 700
    const n = Number(k)
    return Number.isFinite(n) && n >= 100 && n <= 950 ? n : undefined
  }
  if (ownOnly) {
    const win = cx.base.cascaded(chain, ['font-weight', 'font'])
    if (!win) return undefined
    if (/^(?:inherit|unset)$/i.test(win.value)) return fontWeightOf(cx, chain.slice(0, -1), false)
    return parse(win.prop === 'font' ? parseFontShorthand(win.value).weight || 'normal' : win.value)
  }
  const win = inheritedAny(cx, chain, ['font-weight', 'font'])
  if (!win) return undefined
  return parse(win.prop === 'font' ? parseFontShorthand(win.value).weight || 'normal' : win.value)
}

function lineHeightOf(cx: Cascades, chain: CssEl[]): string | undefined {
  const win = inheritedAny(cx, chain, ['line-height', 'font'])
  if (!win) return undefined
  const raw = win.prop === 'font' ? parseFontShorthand(win.value).lineHeight : win.value
  const v = raw?.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!v || v === 'normal') return undefined
  if (/^(?:\d+\.?\d*|\.\d+)$/.test(v)) return v
  const at = fontSizePx(cx, chain.slice(0, win.at + 1))
  const own = fontSizePx(cx, chain)
  const px = evalLength(v, { em: at, rem: cx.rootPx, percent: at })
  if (px === null) return undefined
  // % และ em คงสัดส่วนเดิมเมื่อประกาศบน element นี้เอง
  if (isRelative(v)) return win.at === chain.length - 1 ? round(px / at) : `${round(px)}px`
  return own > 0 ? v : undefined
}

function cleanFont(raw: string | undefined): string | undefined {
  const v = raw?.trim().replace(/\s+/g, ' ')
  if (!v || /^(?:inherit|initial|unset|revert)$/i.test(v)) return undefined
  // เครื่องหมายคำพูดคี่ = สตริงไม่ปิด ไม่เอาไปเป็น font-family
  if ((v.match(/'/g) || []).length % 2 || (v.match(/"/g) || []).length % 2) return undefined
  return v
}

function fontFamilyOf(cx: Cascades, chain: CssEl[]): string | undefined {
  const win = inheritedAny(cx, chain, ['font-family', 'font'])
  if (!win) return undefined
  return cleanFont(win.prop === 'font' ? parseFontShorthand(win.value).family : win.value)
}

function colorOf(cx: Cascades, chain: CssEl[]): string | undefined {
  for (let i = chain.length; i > 0; i--) {
    const sub = chain.slice(0, i)
    const v = cx.base.cascaded(sub, ['color'])?.value
    if (!v || /^(?:inherit|unset|currentcolor)$/i.test(v)) continue
    const c = cssColor(v)
    if (c) return c
  }
  return undefined
}

/** ค่าด้านใดด้านหนึ่งจาก padding/margin ทั้ง longhand และ shorthand */
function side(cx: Cascades, chain: CssEl[], name: 'margin' | 'padding', which: 'top' | 'right' | 'bottom' | 'left', em: number): string | undefined {
  const win = cx.base.cascaded(chain, [`${name}-${which}`, name])
  if (!win) return undefined
  if (win.prop !== name) return normLen(win.value, em, cx.rootPx)
  const parts = splitSpace(win.value)
  const idx = { top: 0, right: 1, bottom: 2, left: 3 }[which]
  const pick = parts.length === 1 ? parts[0] : parts.length === 2 ? parts[idx % 2] : parts.length === 3 ? parts[idx === 3 ? 1 : idx] : parts[idx]
  return normLen(pick, em, cx.rootPx)
}

function sides(cx: Cascades, chain: CssEl[], name: 'margin' | 'padding', em: number): string | undefined {
  const t = side(cx, chain, name, 'top', em)
  const r = side(cx, chain, name, 'right', em)
  const b = side(cx, chain, name, 'bottom', em)
  const l = side(cx, chain, name, 'left', em)
  if (t === undefined && r === undefined && b === undefined && l === undefined) return undefined
  const v = [t ?? '0', r ?? '0', b ?? '0', l ?? '0']
  if (v[0] === v[2] && v[1] === v[3]) return v[0] === v[1] ? v[0] : `${v[0]} ${v[1]}`
  return v.join(' ')
}

function borderOf(cx: Cascades, chain: CssEl[], em: number): { width?: string; color?: string } {
  const widthWin = cx.base.cascaded(chain, ['border-top-width', 'border-width', 'border-top', 'border'])
  const colorWin = cx.base.cascaded(chain, ['border-top-color', 'border-color', 'border-top', 'border'])
  const styleWin = cx.base.cascaded(chain, ['border-top-style', 'border-style', 'border-top', 'border'])
  if (!widthWin && !colorWin && !styleWin) return {}
  const shorthand = (v: string) => splitSpace(v)
  const isShort = (p: string) => p === 'border' || p === 'border-top'
  const STYLE = /^(?:none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset)$/i
  const style = styleWin ? (isShort(styleWin.prop) ? shorthand(styleWin.value).find((t) => STYLE.test(t)) : splitSpace(styleWin.value)[0]) : undefined
  if (!style || /^(?:none|hidden)$/i.test(style)) {
    // border: 0 หรือไม่ได้ตั้ง style = ไม่มีเส้น
    return { width: '0' }
  }
  const widthRaw = widthWin ? (isShort(widthWin.prop) ? shorthand(widthWin.value).find((t) => !STYLE.test(t) && evalLength(t, { em, rem: cx.rootPx }) !== null) : splitSpace(widthWin.value)[0]) : undefined
  const colorRaw = colorWin ? (isShort(colorWin.prop) ? shorthand(colorWin.value).find((t) => !STYLE.test(t) && evalLength(t, { em, rem: cx.rootPx }) === null) : colorWin.value) : undefined
  const named = /^thin$/i.test(widthRaw || '') ? '1px' : /^medium$/i.test(widthRaw || '') || !widthRaw ? '3px' : /^thick$/i.test(widthRaw) ? '5px' : widthRaw
  const width = normLen(named, em, cx.rootPx)
  return { width, color: cssColor(colorRaw) }
}

function boxOf(cx: Cascades, chain: CssEl[], em: number): UploadBoxStyle {
  const bg = cx.base.cascaded(chain, ['background-color', 'background'])
  const border = borderOf(cx, chain, em)
  const radius = cx.base.cascaded(chain, ['border-radius'])?.value
  const radiusParts = radius ? splitSpace(radius.split('/')[0]) : []
  return dropEmpty<UploadBoxStyle>({
    background: firstColorRaw(bg?.value),
    borderColor: border.color,
    borderWidth: border.width,
    radius: radiusParts.length ? normLen(radiusParts[0], em, cx.rootPx) : undefined,
    padding: sides(cx, chain, 'padding', em),
    margin: sides(cx, chain, 'margin', em),
  })
}

function dropEmpty<T extends object>(o: T): T {
  const out = { ...o } as Record<string, unknown>
  for (const k of Object.keys(out)) if (out[k] === undefined || out[k] === '') delete out[k]
  return out as T
}

function textOf(cx: Cascades, chain: CssEl[], boldByDefault = false): UploadTextStyle {
  const em = fontSizePx(cx, chain)
  // หัวข้อ/strong เบราว์เซอร์ตั้งตัวหนาให้เอง จึงไม่สืบทอดจากพ่อถ้าไม่ได้ประกาศบนตัวมันเอง
  const weight = boldByDefault ? fontWeightOf(cx, chain, true) ?? 700 : fontWeightOf(cx, chain, false)
  const ls = inheritedAny(cx, chain, ['letter-spacing'])?.value
  return dropEmpty<UploadTextStyle>({
    fontFamily: fontFamilyOf(cx, chain),
    fontSize: rawFontSize(cx, chain),
    fontWeight: weight,
    lineHeight: lineHeightOf(cx, chain),
    letterSpacing: ls && !/^normal$/i.test(ls) ? normLen(ls, em, cx.rootPx) : undefined,
    color: colorOf(cx, chain),
    marginTop: side(cx, chain, 'margin', 'top', em),
    marginBottom: side(cx, chain, 'margin', 'bottom', em),
  })
}

/** เส้นตกแต่งเหนือหัวข้อ ::before ที่กว้าง-สูงจริง — ไม่มีหรือเป็นไอคอน/ตำแหน่งลอยถือว่าไม่มี */
function ornamentOf(cx: Cascades, chain: CssEl[]): UploadHeadingOrnament | undefined {
  const content = cx.before.declared(chain, 'content')
  if (content === null || /^(?:none|normal)$/i.test(content.trim())) return undefined
  if (/^["'].+["']$/.test(content.trim())) return undefined
  const position = cx.before.declared(chain, 'position')
  if (position && /absolute|fixed/i.test(position)) return undefined
  const em = fontSizePx(cx, chain)
  const width = normLen(cx.before.cascaded(chain, ['width'])?.value, em, cx.rootPx)
  const height = normLen(cx.before.cascaded(chain, ['height'])?.value, em, cx.rootPx)
  if (!width || !height || width === 'auto' || height === 'auto' || width === '0' || height === '0') return undefined
  const color = firstColorRaw(cx.before.cascaded(chain, ['background-color', 'background'])?.value)
  if (!color || color === 'transparent') return undefined
  return dropEmpty<UploadHeadingOrnament>({
    width,
    height,
    color,
    marginBottom: normLen(cx.before.cascaded(chain, ['margin-bottom'])?.value, em, cx.rootPx),
  })
}

// ── หา element ตัวแทนในกล่องเนื้อหา ─────────────────────────────────────────

const NAV_LIKE = /(?:^|[-_])(?:toc|nav|menu|breadcrumb|table-of-contents|pagination|share|social|related)(?:$|[-_])/i

/** element ที่ตื้นสุดจาก 8 ตัวแรกที่ตรง re — ข้ามตัวที่อยู่ในสารบัญ/เมนู */
function shallowest(page: string, region: ArticleRegion, re: RegExp): CssEl[] | null {
  const offset = region.start + region.openTag.length
  const inner = page.slice(offset, region.end)
  // ตรวจเฉพาะชั้นในกล่องเนื้อหา — class บน <body> ของบางธีม (nav-dropdown-...) ต้องไม่ทำให้ข้ามทุกตัว
  const outer = openChainAt(page, region.start).length + 1
  let best: CssEl[] | null = null
  let m: RegExpExecArray | null
  re.lastIndex = 0
  let seen = 0
  while (seen < 8 && (m = re.exec(inner))) {
    const tag = m[1] || /^<[^>]*>/.exec(m[0])?.[0] || m[0]
    const at = offset + m.index + m[0].length - tag.length
    const chain = [...openChainAt(page, at), parseOpenTag(tag)]
    if (chain.slice(outer).some((el) => el.tag === 'nav' || Array.from(el.classes).some((c) => NAV_LIKE.test(c)))) continue
    seen++
    if (!best || chain.length < best.length) best = chain
  }
  return best
}

const virtual = (tag: string): CssEl => ({ tag, id: '', classes: new Set<string>() })

function pseudoRules(rules: CssRule[], pseudo: RegExp): CssRule[] {
  const out: CssRule[] = []
  for (const r of rules) {
    if (!pseudo.test(r.selector)) continue
    const parts = splitTop(r.selector, ',')
      .filter((s) => pseudo.test(s))
      .map((s) => s.replace(pseudo, '').trim())
      .filter(Boolean)
    if (parts.length) out.push({ selector: parts.join(','), body: r.body })
  }
  return out
}

// ── ไฟล์ฟอนต์ ───────────────────────────────────────────────────────────────

const fontNames = (stack: string | undefined): string[] =>
  (stack || '')
    .split(',')
    .map((f) => f.trim().replace(/^['"]|['"]$/g, '').toLowerCase())
    .filter(Boolean)

/** บล็อก @font-face ทุกก้อน — สแกนเส้นตรง (ไม่ใช้ regex [^}]* ที่เป็นกำลังสองเมื่อ CSS ไม่ปิดปีกกา) */
export function fontFaceBlocks(css: string): Array<{ start: number; end: number; body: string }> {
  const out: Array<{ start: number; end: number; body: string }> = []
  const re = new RegExp('@font-face', 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(css))) {
    let i = m.index + m[0].length
    while (i < css.length && /\s/.test(css[i])) i++
    if (css[i] !== '{') continue
    const close = css.indexOf('}', i + 1)
    // ไม่มีปีกกาปิดเลย = ก้อนถัดไปก็ไม่มีเช่นกัน หยุดทันที
    if (close === -1) break
    if (close - i > FONT_FACE_BLOCK_MAX) {
      re.lastIndex = close + 1
      continue
    }
    out.push({ start: m.index, end: close + 1, body: css.slice(i + 1, close) })
    re.lastIndex = close + 1
  }
  return out
}

const FONT_FACE_BLOCK_MAX = 20_000

/** ทำ url() ใน @font-face ให้เป็นลิงก์เต็ม — CSS ถูกรวมเป็นก้อนเดียวแล้วฐานจะหาย */
export function absolutizeFontUrls(css: string, base: string): string {
  if (!/@font-face|@import/i.test(css)) return css
  const out = css.replace(/@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?/gi, (all, _q: string, url: string) => {
    try {
      return `@import url("${new URL(url.trim(), base).toString()}")`
    } catch {
      return all
    }
  })
  const fix = (block: string) =>
    block.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (all, _q: string, url: string) => {
      if (/^data:/i.test(url)) return all
      try {
        return `url("${new URL(url.trim(), base).toString()}")`
      } catch {
        return all
      }
    })
  let res = ''
  let at = 0
  for (const b of fontFaceBlocks(out)) {
    res += out.slice(at, b.start) + fix(out.slice(b.start, b.end))
    at = b.end
  }
  return res + out.slice(at)
}

/** @font-face ของฟอนต์ที่บทความใช้จริง — เลือก woff2 ก่อน, น้ำหนักที่ใช้จริงมาก่อน, ไม่เกิน 24 ไฟล์ */
export function parseFontFaces(css: string, stacks: Array<string | undefined>, weights: Array<number | undefined>): UploadFontFace[] {
  const wanted = new Set(stacks.flatMap(fontNames))
  if (!wanted.size) return []
  const usedWeights = new Set(weights.filter((w): w is number => typeof w === 'number'))
  const faces: UploadFontFace[] = []
  const seen = new Set<string>()
  for (const blk of fontFaceBlocks(css)) {
    const body = blk.body
    const get = (prop: string) => new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`, 'i').exec(body)?.[1]?.trim()
    const family = get('font-family')?.replace(/^['"]|['"]$/g, '').trim()
    if (!family || !wanted.has(family.toLowerCase())) continue
    const src = /(?:^|;|\s)src\s*:\s*([\s\S]*?)(?:;|$)/i.exec(body)?.[1] || ''
    const urls = Array.from(src.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)(?:\s*format\(\s*['"]?([\w-]+)['"]?\s*\))?/gi), (u) => ({ url: u[1].trim(), format: u[2]?.toLowerCase() }))
    const pick =
      urls.find((u) => u.format === 'woff2' || /\.woff2(?:[?#]|$)/i.test(u.url)) ||
      urls.find((u) => u.format === 'woff' || /\.woff(?:[?#]|$)/i.test(u.url)) ||
      urls.find((u) => /^https:\/\//i.test(u.url))
    // ไฟล์เดียวกันอาจถูกประกาศหลายชื่อฟอนต์ (Full Sans SC ใช้ไฟล์ Jost) — กันซ้ำที่ชื่อ + น้ำหนัก + ไฟล์
    const key = `${family.toLowerCase()}|${get('font-weight') || ''}|${pick?.url || ''}`
    if (!pick || !/^https:\/\//i.test(pick.url) || seen.has(key)) continue
    seen.add(key)
    faces.push(
      dropEmpty<UploadFontFace>({
        family,
        weight: get('font-weight'),
        style: get('font-style'),
        url: pick.url,
        format: pick.format,
        unicodeRange: get('unicode-range'),
      }),
    )
  }
  const inUse = (f: UploadFontFace) => {
    const n = Number(f.weight)
    if (!Number.isFinite(n)) return true
    return usedWeights.has(n)
  }
  return [...faces.filter(inUse), ...faces.filter((f) => !inUse(f))].slice(0, 24)
}

// ── หน้าตาบทความ ────────────────────────────────────────────────────────────

export function scanArticleStyle(input: {
  page: string
  region: ArticleRegion
  rules: CssRule[]
  /** CSS ดิบทั้งหน้า สำหรับอ่าน @font-face */
  rawCss: string
  sourceUrl?: string
  pageBackground?: string | null
}): UploadArticleStyle | null {
  const { page, region, rules, rawCss, sourceUrl } = input
  const base = new CssCascade(rules, { watch: ARTICLE_WATCHED })
  const cx: Cascades = {
    base,
    before: new CssCascade(pseudoRules(rules, /::?before\s*$/i), { watch: ARTICLE_WATCHED }),
    marker: new CssCascade(pseudoRules(rules, /::marker\s*$/i), { watch: ARTICLE_WATCHED }),
    rootPx: 16,
  }
  const html = parseOpenTag(/<html\b[^>]*>/i.exec(page)?.[0] || '<html>')
  cx.rootPx = fontSizePx(cx, [html]) || 16

  const contentChain = [...openChainAt(page, region.start), parseOpenTag(region.openTag)]
  // ไม่มีย่อหน้าข้อความเลย = ไม่ใช่หน้าบทความ
  // เลือกย่อหน้ายาวก่อน ย่อหน้าสั้นมักเป็นคำบรรยายภาพหรือป้ายกำกับที่มีสไตล์ของตัวเอง
  const pChain =
    shallowest(page, region, /<p\b[^>]*>(?=\s*(?:<(?:strong|b|em|span|a)\b[^>]*>\s*)*[^<\s])(?=(?:(?!<\/p>)[\s\S]){80,}?<\/p>)/gi) ||
    shallowest(page, region, /<p\b[^>]*>(?=\s*(?:<(?:strong|b|em|span|a)\b[^>]*>\s*)*[^<\s])/gi)
  if (!pChain) return null
  const h2Chain = shallowest(page, region, /<h2\b[^>]*>/gi) || [...contentChain, virtual('h2')]
  const h3Chain = shallowest(page, region, /<h3\b[^>]*>/gi) || [...contentChain, virtual('h3')]
  const h4Chain = shallowest(page, region, /<h4\b[^>]*>/gi) || [...contentChain, virtual('h4')]
  const ulChain = shallowest(page, region, /<ul\b[^>]*>/gi) || [...contentChain, virtual('ul')]
  const liChain = shallowest(page, region, /<li\b[^>]*>/gi) || [...ulChain, virtual('li')]
  const aChain =
    shallowest(page, region, /<p\b[^>]*>(?:(?!<\/p>)[\s\S])*?(<a\b[^>]*href=[^>]*>)/gi) ||
    shallowest(page, region, /<a\b(?![^>]*class=["'][^"']*(?:btn|button))[^>]*href=[^>]*>/gi) || [...pChain, virtual('a')]
  const strongChain =
    shallowest(page, region, /<p\b[^>]*>(?:(?!<\/p>)[\s\S])*?(<(?:strong|b)\b[^>]*>)/gi) || [...pChain, virtual('strong')]
  const imgChain = shallowest(page, region, /<img\b[^>]*>/gi) || [...contentChain, virtual('img')]

  const liEm = fontSizePx(cx, liChain)
  const markerWin = cx.marker.cascaded(liChain, ['color'])
  const listStyleWin = inheritedAny(cx, liChain, ['list-style-type', 'list-style'])
  const listStyle = listStyleWin
    ? listStyleWin.prop === 'list-style'
      ? splitSpace(listStyleWin.value).find((t) => /^(?:none|disc|circle|square|decimal)$/i.test(t))
      : listStyleWin.value.trim()
    : undefined
  const decoWin = cx.base.cascaded(aChain, ['text-decoration-line', 'text-decoration'])
  const decoration = decoWin ? (/underline/i.test(decoWin.value) ? 'underline' : /none/i.test(decoWin.value) ? 'none' : undefined) : undefined
  const contentEm = fontSizePx(cx, contentChain)

  const p = textOf(cx, pChain)
  const h2 = textOf(cx, h2Chain, true)
  const h3 = textOf(cx, h3Chain, true)
  const h4 = textOf(cx, h4Chain, true)
  const li = textOf(cx, liChain)
  const strong = textOf(cx, strongChain, true)
  const link = textOf(cx, aChain)

  const fontFaces = parseFontFaces(
    rawCss,
    [p.fontFamily, h2.fontFamily, h3.fontFamily, h4.fontFamily, li.fontFamily, strong.fontFamily],
    [p.fontWeight, h2.fontWeight, h3.fontWeight, h4.fontWeight, li.fontWeight, strong.fontWeight],
  )

  const width = normLen(base.cascaded(contentChain, ['width'])?.value, contentEm, cx.rootPx)
  const maxWidth = normLen(base.cascaded(contentChain, ['max-width'])?.value, contentEm, cx.rootPx)

  return dropEmpty<UploadArticleStyle>({
    source: sourceUrl,
    container: dropEmpty({
      ...boxOf(cx, contentChain, contentEm),
      width: width && width !== 'auto' && !/%$/.test(width) ? width : maxWidth,
    }),
    p,
    h2: dropEmpty({ ...h2, ornament: ornamentOf(cx, h2Chain) }),
    h3: dropEmpty({ ...h3, ornament: ornamentOf(cx, h3Chain) }),
    h4,
    ul: boxOf(cx, ulChain, fontSizePx(cx, ulChain)),
    li: dropEmpty({
      ...li,
      paddingLeft: side(cx, liChain, 'padding', 'left', liEm),
      marginLeft: side(cx, liChain, 'margin', 'left', liEm),
      markerColor: cssColor(markerWin?.value),
      listStyle,
    }),
    link: dropEmpty({ color: link.color, decoration, fontWeight: fontWeightOf(cx, aChain, true) }),
    strong: dropEmpty({ fontFamily: strong.fontFamily, fontWeight: strong.fontWeight, color: strong.color }),
    // ไม่ได้ประกาศมุมโค้ง = มุมฉาก (ค่าพื้นฐานของเราโค้ง 12px จึงต้องตั้งให้ชัด)
    img: { radius: normLen(base.cascaded(imgChain, ['border-radius'])?.value, fontSizePx(cx, imgChain), cx.rootPx) ?? '0' },
    pageBackground: firstColorRaw(input.pageBackground || undefined),
    fontFaces: fontFaces.length ? fontFaces : undefined,
  })
}

// ── โครงบทความ + แหล่งอ้างอิง ───────────────────────────────────────────────

const FAQ_RE = /FAQ|คำถามที่พบบ่อย|คำถามยอดฮิต|Q\s*&\s*A|ถาม.?ตอบ|frequently asked|คำถามที่(หลายคน|คน|ผู้อ่าน|ลูกค้า)?(มัก|ชอบ)?(ถาม|สงสัย)/i
const CONCLUSION_RE = /^\s*(?:บท)?สรุป|^\s*(?:conclusion|summary)\b/i
const REFERENCES_RE = /^(?:เอกสารอ้างอิง|แหล่งอ้างอิง|ข้อมูลอ้างอิง|รายการอ้างอิง|อ้างอิง|แหล่งที่มา|แหล่งข้อมูล|ที่มา|references?|sources?|bibliography|citations?)\s*[:：]?$/i
const ACCORDION_RE = /<details\b|<summary\b|accordion|toggle|collaps|aria-expanded|elementor-tab-title|ewd-ufaq|helpie-faq/i

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

/** แหล่งอ้างอิงจากเนื้อบทความ: หัวข้อ/ย่อหน้า "อ้างอิง" ตามด้วยรายการที่มีลิงก์ */
export function extractReferencesFromHtml(html: string): { title: string; items: UploadReference[] } | null {
  const root = parseHtml(html)
  for (const el of root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,div,strong')) {
    const label = squash(el.text)
    if (!label || label.length > 40 || !REFERENCES_RE.test(label)) continue
    // <p><strong>อ้างอิง</strong></p> — ใช้ตัวนอกที่มีรายการต่อท้าย
    let at: HTMLElement | null = el
    let list = at.nextElementSibling
    if (!list && at.parentNode && at.parentNode instanceof HTMLElement) {
      at = at.parentNode
      list = at.nextElementSibling
    }
    if (!list || !/^(?:ul|ol)$/i.test(list.tagName || '')) continue
    const items: UploadReference[] = []
    for (const li of list.querySelectorAll('li')) {
      const url = cleanReferenceUrl(li.querySelector('a[href]')?.getAttribute('href'))
      const title = squash(li.text)
      if (url && title.length >= 8) items.push({ title: title.slice(0, 300), url, from: 'site' })
    }
    if (items.length) return { title: label.replace(/\s*[:：]$/, ''), items }
  }
  return null
}

function h2Texts(html: string): string[] {
  return parseHtml(html).querySelectorAll('h2').map((h) => squash(h.text))
}

/** FAQ ในเนื้อบทความ: หัวข้อ FAQ ตามด้วย h3 + ย่อหน้าธรรมดา ไม่มีกล่องกดเปิด = plain */
function faqKind(html: string): 'plain' | 'accordion' | null {
  const m = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi
  let found: RegExpExecArray | null
  while ((found = m.exec(html))) {
    if (!FAQ_RE.test(squash(found[1].replace(/<[^>]+>/g, ' ')))) continue
    const rest = html.slice(found.index + found[0].length)
    const next = rest.search(/<h2\b/i)
    const section = next === -1 ? rest : rest.slice(0, next)
    if (ACCORDION_RE.test(section)) return 'accordion'
    return /<h[3-5]\b/i.test(section) ? 'plain' : null
  }
  return ACCORDION_RE.test(html) && FAQ_RE.test(html) ? 'accordion' : null
}

export interface ScannedStructure {
  structure: UploadArticleStructure
  references: UploadReference[]
}

const LATIN_THAI_MIN_SAMPLES = 10
const LATIN_THAI_MIN_RATIO = 4

/**
 * โครงบทความจากบทความจริงของเว็บ — ตัดสินจากสิ่งที่พบเท่านั้น
 * @param tocFound เจอสารบัญบนเว็บไหม (null = ตรวจไม่ได้ จะไม่ตั้งค่า)
 */
export function scanArticleStructure(bodies: string[], tocFound: boolean | null): ScannedStructure | null {
  const posts = bodies.filter((b) => b && b.trim())
  if (!posts.length) return null
  const library = new Map<string, UploadReference>()
  let refPosts = 0
  const titleCount = new Map<string, number>()
  let bothPosts = 0
  let conclusionFirst = 0
  let takeaways = 0
  const kinds: Array<'plain' | 'accordion'> = []
  let spaced = 0
  let tight = 0
  for (const html of posts) {
    const boundary = countLatinThaiBoundaries(html)
    spaced += boundary.spaced
    tight += boundary.tight
    const refs = extractReferencesFromHtml(html)
    if (refs) {
      refPosts++
      titleCount.set(refs.title, (titleCount.get(refs.title) || 0) + 1)
      for (const r of refs.items) if (!library.has(r.url)) library.set(r.url, r)
    }
    const heads = h2Texts(html)
    if (heads.some((h) => TAKEAWAYS_HEADING_RE.test(h)) || /content-takeaways|key-takeaway/i.test(html)) takeaways++
    const faqAt = heads.findIndex((h) => FAQ_RE.test(h))
    const conclusionAt = heads.findIndex((h) => CONCLUSION_RE.test(h))
    if (faqAt !== -1 && conclusionAt !== -1) {
      bothPosts++
      if (conclusionAt < faqAt) conclusionFirst++
    }
    const kind = faqKind(html)
    if (kind) kinds.push(kind)
  }
  const plain = kinds.filter((k) => k === 'plain').length
  const topTitle = Array.from(titleCount.entries()).sort((a, b) => b[1] - a[1])[0]?.[0]
  const structure: UploadArticleStructure = {
    posts: posts.length,
    ...(tocFound === null ? {} : { toc: tocFound }),
    takeaways: takeaways > 0,
    references: refPosts > 0,
    ...(topTitle ? { referencesTitle: topTitle } : {}),
    ...(bothPosts ? { conclusionBeforeFaq: conclusionFirst * 2 >= bothPosts } : {}),
    ...(kinds.length && plain * 2 >= kinds.length ? { faqPlain: true } : {}),
    // เปิดเมื่อตัวอย่างพอและเว็บเว้นวรรคสม่ำเสมอเท่านั้น — เว็บที่เขียนติดกันคงตามเดิม
    ...(spaced + tight >= LATIN_THAI_MIN_SAMPLES && spaced >= tight * LATIN_THAI_MIN_RATIO ? { latinThaiSpacing: true } : {}),
  }
  return { structure, references: Array.from(library.values()).slice(0, 200) }
}
