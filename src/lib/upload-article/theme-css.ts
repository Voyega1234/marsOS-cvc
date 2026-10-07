// ─── Upload Article — CSS เสริมจากธีมละเอียด (FAQ card / ตาราง) ─────────────────
// ไฟล์นี้ pure ไม่มี dependency ฝั่ง server — ใช้ได้ทั้ง build-html และ live preview ในหน้า Generate
// ทุกค่าที่มาจากผู้ใช้หรือ AI ต้องผ่าน sanitizeThemeDetail ก่อนต่อเป็น CSS เสมอ (กัน CSS injection)

import { buildArticleCss, type ArticleCssOptions } from '@/lib/articleComponents'
import {
  UPLOAD_GOOGLE_FONTS,
  type UploadTheme,
  type UploadFaqIcon,
  type UploadFaqStyle,
  type UploadTableStyle,
  type UploadThemeDetail,
} from './types'
import type { UploadCtaItem, UploadCtaSettings } from './cta'

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const RGB_RE = /^rgba?\(\s*\d{1,3}(?:\.\d+)?%?\s*,\s*\d{1,3}(?:\.\d+)?%?\s*,\s*\d{1,3}(?:\.\d+)?%?\s*(?:,\s*(?:0|1|0?\.\d+|\d{1,3}%)\s*)?\)$/i
const LEN_RE = /^(?:-?\d+(?:\.\d+)?(?:px|em|rem|%)?\s*){1,4}$/
const FONT_SIZE_RE = /^\d+(?:\.\d+)?(?:px|em|rem|%)$/
const ICONS: UploadFaqIcon[] = ['plus', 'chevron', 'caret', 'arrow', 'none']

export function safeColor(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  if (!s) return undefined
  if (s.toLowerCase() === 'transparent') return 'transparent'
  if (HEX_RE.test(s) || RGB_RE.test(s)) return s
  return undefined
}

function safeLen(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return `${Math.max(0, Math.min(80, v))}px`
  if (typeof v !== 'string') return undefined
  const s = v.trim().replace(/\s+/g, ' ')
  return s && s.length <= 40 && LEN_RE.test(s) ? s : undefined
}

function safeNum(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === 'string' ? parseFloat(v) : v
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined
  return Math.max(min, Math.min(max, Math.round(n * 10) / 10))
}

function pickEnum<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined
}

/** ตัด key ที่เป็น undefined ทิ้ง — คืน undefined ถ้าไม่เหลืออะไร */
function compact<T extends object>(o: T): T | undefined {
  const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
  return Object.keys(out).length ? out : undefined
}

export function sanitizeFaqStyle(raw: unknown): UploadFaqStyle | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const size = typeof r.questionFontSize === 'string' && FONT_SIZE_RE.test(r.questionFontSize.trim()) ? r.questionFontSize.trim() : undefined
  return compact<UploadFaqStyle>({
    layout: pickEnum(r.layout, ['card', 'divider', 'plain'] as const),
    itemBackground: safeColor(r.itemBackground),
    itemBorderColor: safeColor(r.itemBorderColor),
    itemBorderWidth: safeNum(r.itemBorderWidth, 0, 6),
    itemRadius: safeNum(r.itemRadius, 0, 40),
    itemGap: safeNum(r.itemGap, 0, 48),
    itemShadow: typeof r.itemShadow === 'boolean' ? r.itemShadow : undefined,
    questionBackground: safeColor(r.questionBackground),
    questionColor: safeColor(r.questionColor),
    questionFontSize: size,
    questionWeight: safeNum(r.questionWeight, 300, 900),
    questionPadding: safeLen(r.questionPadding),
    openQuestionBackground: safeColor(r.openQuestionBackground),
    openQuestionColor: safeColor(r.openQuestionColor),
    answerBackground: safeColor(r.answerBackground),
    answerColor: safeColor(r.answerColor),
    answerPadding: safeLen(r.answerPadding),
    icon: pickEnum(r.icon, ICONS),
    iconPosition: pickEnum(r.iconPosition, ['left', 'right'] as const),
    iconColor: safeColor(r.iconColor),
  })
}

export function sanitizeTableStyle(raw: unknown): UploadTableStyle | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  return compact<UploadTableStyle>({
    headerBackground: safeColor(r.headerBackground),
    headerColor: safeColor(r.headerColor),
    borderColor: safeColor(r.borderColor),
    stripeBackground: safeColor(r.stripeBackground),
  })
}

export function sanitizeThemeDetail(raw: unknown): UploadThemeDetail | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const source = typeof r.source === 'string' ? r.source.replace(/[<>{}]/g, '').trim().slice(0, 200) : undefined
  return compact<UploadThemeDetail>({
    source: source || undefined,
    faq: sanitizeFaqStyle(r.faq),
    table: sanitizeTableStyle(r.table),
  })
}

/** ความสว่างสัมพัทธ์ของสี hex (คืน null ถ้าไม่ใช่ hex) */
function luminance(color: string): number | null {
  let h = color.trim().replace(/^#/, '')
  if (!/^[0-9a-f]+$/i.test(h)) return null
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('')
  else if (h.length === 6 || h.length === 8) h = h.slice(0, 6)
  else return null
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function isLight(color: string): boolean {
  const l = luminance(color)
  return l === null ? true : l > 0.45
}

function lowContrast(a: string, b: string): boolean {
  const la = luminance(a)
  const lb = luminance(b)
  if (la === null || lb === null) return false
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05) < 3
}

const Q = '.content-article .content-faq__question'
const ITEM = '.content-article .content-faq__item'

function iconCss(icon: UploadFaqIcon, color: string | undefined, left: boolean): string[] {
  const out: string[] = []
  const c = color ? `color:${color};` : ''
  const order = left ? 'order:-1;' : ''
  if (left) out.push(`${Q}{justify-content:flex-start;}`)
  if (icon === 'none') {
    out.push(`${Q}::after{content:none;display:none;}`)
    return out
  }
  if (icon === 'chevron') {
    // ลูกศรหัก สร้างจากขอบ 2 ด้าน หมุนเมื่อเปิด
    out.push(`${Q}::after{content:"";width:.5em;height:.5em;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(45deg) translate(-2px,-2px);transition:transform .2s;${c}${order}}`)
    out.push(`${ITEM}[open] .content-faq__question::after{content:"";transform:rotate(-135deg) translate(-2px,-2px);}`)
    return out
  }
  const closed = icon === 'caret' ? '▸' : icon === 'arrow' ? '↓' : '+'
  const open = icon === 'caret' ? '▾' : icon === 'arrow' ? '↑' : '−'
  out.push(`${Q}::after{content:"${closed}";${c}${order}}`)
  out.push(`${ITEM}[open] .content-faq__question::after{content:"${open}";}`)
  return out
}

/** CSS ทับค่า default ของ buildArticleCss — รับเฉพาะค่าที่ sanitize แล้ว */
export function themeDetailCss(detail: UploadThemeDetail | undefined): string {
  const d = sanitizeThemeDetail(detail)
  if (!d) return ''
  const lines: string[] = []
  const f = d.faq
  if (f) {
    const item: string[] = []
    const layout = f.layout || 'card'
    const bw = f.itemBorderWidth ?? 1
    if (layout === 'card') {
      if (f.itemBorderColor) item.push(`border:${bw}px solid ${f.itemBorderColor};`)
      else if (f.itemBorderWidth !== undefined) item.push(`border-width:${bw}px;`)
      if (f.itemRadius !== undefined) item.push(`border-radius:${f.itemRadius}px;`)
      if (f.itemShadow) item.push('box-shadow:0 2px 10px rgba(0,0,0,.08);')
      else if (f.itemShadow === false) item.push('box-shadow:none;')
    } else if (layout === 'divider') {
      item.push(`border:0;border-radius:0;border-bottom:${bw || 1}px solid ${f.itemBorderColor || 'rgba(0,0,0,.12)'};`)
    } else {
      item.push('border:0;border-radius:0;')
    }
    if (f.itemBackground) item.push(`background:${f.itemBackground};`)
    if (f.itemGap !== undefined) item.push(`margin:${f.itemGap}px 0;`)
    if (item.length) lines.push(`${ITEM}{${item.join('')}}`)

    const q: string[] = []
    if (f.questionBackground) q.push(`background:${f.questionBackground};`)
    if (f.questionColor) q.push(`color:${f.questionColor};`)
    if (f.questionFontSize) q.push(`font-size:${f.questionFontSize};`)
    if (f.questionWeight) q.push(`font-weight:${f.questionWeight};`)
    if (f.questionPadding) q.push(`padding:${f.questionPadding};`)
    if (layout !== 'card' && !f.questionPadding) q.push('padding-left:0;padding-right:0;')
    if (q.length) lines.push(`${Q}{${q.join('')}}`)

    const oq: string[] = []
    if (f.openQuestionBackground) oq.push(`background:${f.openQuestionBackground};`)
    if (f.openQuestionColor) oq.push(`color:${f.openQuestionColor};`)
    if (oq.length) lines.push(`${ITEM}[open] .content-faq__question{${oq.join('')}}`)

    if (f.icon || f.iconColor || f.iconPosition) {
      lines.push(...iconCss(f.icon || 'plus', f.iconColor, f.iconPosition === 'left'))
    }

    const a: string[] = []
    if (f.answerBackground) a.push(`background:${f.answerBackground};`)
    if (f.answerColor) a.push(`color:${f.answerColor};`)
    if (f.answerPadding) a.push(`padding:${f.answerPadding};`)
    else if (f.answerBackground) a.push('padding-top:.9em;')
    if (layout !== 'card' && !f.answerPadding) a.push('padding-left:0;padding-right:0;')
    if (a.length) lines.push(`.content-article .content-faq__answer{${a.join('')}}`)
  }
  const t = d.table
  if (t) {
    const th: string[] = []
    // หัวตาราง default = พื้นสีธีม + ตัวขาว — ถ้าระบุแค่ฝั่งเดียวหรือสีกลืนกัน ต้องแก้อีกฝั่งให้อ่านออก
    let headBg = t.headerBackground
    let headColor = t.headerColor
    if (!headBg && headColor) headBg = isLight(headColor) ? 'rgba(0,0,0,.35)' : 'rgba(0,0,0,.04)'
    if (headBg && (!headColor || lowContrast(headBg, headColor))) {
      const light = headBg.startsWith('rgba(0,0,0,') ? headBg === 'rgba(0,0,0,.04)' : isLight(headBg)
      headColor = light ? '#111111' : '#ffffff'
    }
    if (headBg) th.push(`background:${headBg};`)
    if (headColor) th.push(`color:${headColor};`)
    if (th.length) lines.push(`.content-article .content-table th{${th.join('')}}`)
    if (t.borderColor) lines.push(`.content-article .content-table th,.content-article .content-table td{border:1px solid ${t.borderColor};}`)
    if (t.stripeBackground) lines.push(`.content-article .content-table tr:nth-child(even) td{background:${t.stripeBackground};}`)
  }
  return lines.join('\n')
}

const DRAFT_FONT_RE = /^[\w\sÀ-ɏ฀-๿'",-]*$/

function sanitizeDraftColor(v: string | undefined): string {
  return typeof v === 'string' && (v === '' || HEX_RE.test(v) || RGB_RE.test(v)) ? v : ''
}

function sanitizeDraftFont(v: string | undefined): string | undefined {
  if (typeof v !== 'string') return undefined
  return v.length <= 200 && DRAFT_FONT_RE.test(v) ? v : undefined
}

/**
 * sanitize ธีมฉบับร่าง (ยังไม่บันทึก) ก่อนสร้าง CSS พรีวิวสดในหน้า Generate — เกณฑ์เดียวกับฝั่ง server ตอน PATCH
 * กันผู้ใช้พิมพ์ CSS/HTML แปลกปลอมลงช่องสี/ฟอนต์แล้วโดนต่อเป็น CSS จริงในพรีวิวก่อนผ่านการตรวจของ server
 */
export function sanitizeThemeDraft(theme: UploadTheme): UploadTheme {
  return {
    ...theme,
    theme: sanitizeDraftColor(theme.theme),
    text: sanitizeDraftColor(theme.text),
    border: sanitizeDraftColor(theme.border),
    accent: sanitizeDraftColor(theme.accent),
    background: sanitizeDraftColor(theme.background),
    pageBackground: sanitizeDraftColor(theme.pageBackground),
    fontFamily: sanitizeDraftFont(theme.fontFamily),
    headingFont: sanitizeDraftFont(theme.headingFont),
    detail: sanitizeThemeDetail(theme.detail),
  }
}

/** @import เฉพาะฟอนต์ Google ที่เลือกไว้ (ฟอนต์อื่น/inherit ไม่ต้องโหลด) */
export function googleFontImport(stacks: Array<string | undefined>): string {
  const families = new Set<string>()
  for (const stack of stacks) {
    const first = (stack || '').split(',')[0].replace(/['"]/g, '').trim()
    if (UPLOAD_GOOGLE_FONTS.includes(first)) families.add(first)
  }
  if (families.size === 0) return ''
  const q = Array.from(families).map((f) => `family=${f.replace(/ /g, '+')}:wght@400;500;700`).join('&')
  return `@import url('https://fonts.googleapis.com/css2?${q}&display=swap');\n`
}

const UPLOAD_EXTRA_CSS = `.content-article .content-faq__question{text-align:left;}\n.content-article .content-faq__q{flex:1 1 auto;min-width:0;text-align:left;}`

/** CSS เพิ่มของกล่อง CTA (Project Setting > CTA): จัดซ้าย/ขวา, ปุ่มแนวตั้ง, ปุ่มแบบข้อความ, โลโก้ในปุ่ม, แบนเนอร์ไม่มีกรอบ */
const UPLOAD_CTA_EXTRA_CSS = [
  '.content-article .content-cta__button{display:inline-flex;align-items:center;gap:.45em;}',
  '.content-article .content-cta__button--ghost{background:transparent;border:0;text-decoration:underline;color:inherit;}',
  '.content-article .content-cta__icon{width:1.25em;height:1.25em;border-radius:999px;object-fit:cover;margin:0;}',
  '.content-article .content-cta--left{text-align:left;}',
  '.content-article .content-cta--left .content-cta__buttons{justify-content:flex-start;}',
  '.content-article .content-cta--right{text-align:right;}',
  '.content-article .content-cta--right .content-cta__buttons{justify-content:flex-end;}',
  '.content-article .content-cta--column .content-cta__buttons{flex-direction:column;align-items:center;}',
  '.content-article .content-cta--column.content-cta--left .content-cta__buttons{align-items:flex-start;}',
  '.content-article .content-cta--column.content-cta--right .content-cta__buttons{align-items:flex-end;}',
  '.content-article .content-cta--banner{border:0;background:transparent;padding:0;}',
  '.content-article .content-cta--banner a{display:block;}',
].join('\n')

const CTA_CSS_COLOR_RE = /^#[0-9a-f]{3,8}$/i
const isValidCtaCssColor = (v: unknown): v is string => typeof v === 'string' && (CTA_CSS_COLOR_RE.test(v) || v === 'transparent')

/** CSS เฉพาะ CTA แบบ "ออกแบบเอง" 1 แบบ — เจาะจงด้วย .content-cta--u-<id> กัน CTA แบบอื่นในหน้าเดียวกันโดนทับสี
 * (buildArticleCss คุมได้แค่ CTA เดียวต่อบทความ ตอนนี้มีได้หลายแบบพร้อมกันจึงต้องสโคปเอง) */
function ctaItemScopedCss(item: UploadCtaItem): string {
  if (item.mode !== 'custom' || !item.custom) return ''
  const c = item.custom
  const sel = `.content-article .content-cta.content-cta--u-${item.id}`
  const boxBg = isValidCtaCssColor(c.boxBg) ? c.boxBg : '#1d48f3'
  const boxText = isValidCtaCssColor(c.boxText) ? c.boxText : '#fff'
  const boxBorderColor = isValidCtaCssColor(c.boxBorderColor) ? c.boxBorderColor : 'transparent'
  const boxBorderWidth = Number.isFinite(c.boxBorderWidth) ? Math.min(6, Math.max(0, c.boxBorderWidth)) : 0
  const boxRadius = Number.isFinite(c.boxRadius) ? Math.min(32, Math.max(0, c.boxRadius)) : 16
  const buttonBg = isValidCtaCssColor(c.buttonBg) ? c.buttonBg : '#fff'
  const buttonText = isValidCtaCssColor(c.buttonText) ? c.buttonText : boxBg
  const buttonBorderColor = isValidCtaCssColor(c.buttonBorderColor) ? c.buttonBorderColor : 'transparent'
  const buttonRadius = Number.isFinite(c.buttonRadius) ? Math.min(32, Math.max(0, c.buttonRadius)) : 10
  return [
    `${sel}{background:${boxBg};color:${boxText};border:${boxBorderWidth}px solid ${boxBorderColor};border-radius:${boxRadius}px;}`,
    `${sel} .content-cta__headline{color:${boxText};}`,
    `${sel} .content-cta__subtext{color:${boxText};}`,
    `${sel} .content-cta__button{background:${buttonBg};color:${buttonText};border:1.5px solid ${buttonBorderColor};border-radius:${buttonRadius}px;}`,
    `${sel} .content-cta__button--secondary{background:transparent;color:${boxText};border-color:${boxText};}`,
  ].join('\n')
}

/** CSS เต็มของบทความ Upload Article (ใช้ทั้งตอน generate และพรีวิวสดในหน้า Generate)
 *  cta = ตั้งค่า CTA ของลูกค้า (หลายแบบ) — แบบ "ออกแบบเอง" ได้ CSS เจาะจงของตัวเอง ส่วนโหมดอื่นใช้สีธีมเดียวกันหมด */
export function buildUploadCss(
  theme: UploadTheme,
  cta?: UploadCtaSettings,
  extra?: { articleCta?: ArticleCssOptions['cta'] },
): string {
  const css = buildArticleCss({
    themeColor: theme.theme,
    textColor: theme.text,
    borderColor: theme.border,
    accentColor: theme.accent,
    backgroundColor: theme.background,
    typography: { fontFamily: theme.fontFamily, headingFont: theme.headingFont },
    ...(extra?.articleCta ? { cta: extra.articleCta } : {}),
  })
  const fontImport = googleFontImport([theme.fontFamily, theme.headingFont])
  const detailCss = themeDetailCss(theme.detail)
  const scopedCtaCss = (cta?.items ?? []).map(ctaItemScopedCss).filter(Boolean).join('\n')
  return `${fontImport}${css}\n${UPLOAD_EXTRA_CSS}\n${UPLOAD_CTA_EXTRA_CSS}${scopedCtaCss ? `\n${scopedCtaCss}` : ''}${detailCss ? `\n${detailCss}` : ''}`
}
