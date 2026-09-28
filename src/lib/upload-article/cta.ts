// ─── Upload Article — CTA (Call-to-Action) ต่อลูกค้า ──────────────────────────────
// ตั้งค่าใน Project Setting > CTA (3 แบบเหมือนหน้า Clients: ปุ่มมาตรฐาน / ออกแบบเอง / แบนเนอร์รูป)
// เก็บใน UploadClient.pushPrefs.cta — ไม่ส่งไปกับ UploadClientDTO (แบนเนอร์เป็น base64 หนัก) ส่งแค่ ctaSummary
// ตอนเขียนบทความ (ติ๊ก "ใส่ CTA") ระบบแทรกกล่อง CTA เองจากข้อความที่ทีมตั้ง — AI ไม่ได้แต่งข้อความ CTA
// ไฟล์นี้ pure (ใช้ได้ทั้งหน้า UI และ server) — ตัวแทรกลงบทความอยู่ที่ cta-insert.ts
// แทรกลง sourceHtml เป็น top-level block → Generate ใหม่กี่รอบ CTA ก็ยังอยู่ ส่วนสี/กรอบมาจาก CSS ตอน build
//
// ตั้งแต่ 2026-09-28: CTA ตั้งได้หลายแบบ (items) — 1 บทความแทรกกี่จุดตาม perArticle แล้วสุ่มหยิบจาก items

import type { CtaBanner, CtaCustomDesign, CtaMode } from '@/lib/articleComponents'

export type UploadCtaChannelType = 'line' | 'facebook' | 'phone' | 'email' | 'website' | 'form' | 'custom'
export type UploadCtaButtonStyle = 'filled' | 'outline' | 'ghost'

export interface UploadCtaChannel {
  type: UploadCtaChannelType
  label: string
  value: string
  icon?: string
  /** รูป/โลโก้ในปุ่ม (data URL ย่อแล้ว) */
  imageUrl?: string
  buttonStyle?: UploadCtaButtonStyle
}

/** CTA 1 แบบ — ตั้งได้หลายแบบใน items ของ UploadCtaSettings */
export interface UploadCtaItem {
  id: string
  name: string
  mode: CtaMode
  headline: string
  subtext: string
  channels: UploadCtaChannel[]
  alignment: 'left' | 'center' | 'right'
  buttonLayout: 'row' | 'column'
  custom?: CtaCustomDesign
  banners: CtaBanner[]
}

export interface UploadCtaSettings {
  enabled: boolean
  /** จำนวน CTA ที่แทรกต่อ 1 บทความ (1-5) */
  perArticle: number
  items: UploadCtaItem[]
}

/** ส่งไปกับ DTO ให้หน้าเขียนบทความรู้ว่าตั้ง CTA ไว้หรือยัง (ไม่ต้องโหลดรูปแบนเนอร์) */
export interface UploadCtaSummary {
  enabled: boolean
  /** โหมดของ CTA ตัวแรกที่พร้อมใช้งาน (แสดงในข้อความสรุปหน้าเขียนบทความ) */
  mode: CtaMode
  /** ตั้งค่าครบพอจะแทรกได้จริง (มี item พร้อมใช้อย่างน้อย 1 แบบ) */
  ready: boolean
  /** จำนวน CTA ที่พร้อมใช้งาน */
  count: number
  perArticle: number
}

export const UPLOAD_CTA_MAX_BANNERS = 5
export const UPLOAD_CTA_MAX_ITEMS = 10
export const UPLOAD_CTA_MIN_PER_ARTICLE = 1
export const UPLOAD_CTA_MAX_PER_ARTICLE = 5
export const UPLOAD_CTA_DEFAULT_PER_ARTICLE = 2

export const UPLOAD_CTA_CHANNEL_TYPES: UploadCtaChannelType[] = ['line', 'facebook', 'phone', 'email', 'website', 'form', 'custom']

const DEFAULT_CTA_HEADLINE = 'สนใจปรึกษาฟรี?'
const DEFAULT_CTA_SUBTEXT = 'ทีมงานพร้อมตอบทุกคำถาม'

/** ค่าเริ่มต้นของ CTA แต่ละแบบ — ใช้ตอนสร้างแบบใหม่ */
export function defaultUploadCtaItem(id: string, name: string): UploadCtaItem {
  return {
    id,
    name,
    mode: 'buttons',
    headline: DEFAULT_CTA_HEADLINE,
    subtext: DEFAULT_CTA_SUBTEXT,
    channels: [],
    alignment: 'center',
    buttonLayout: 'row',
    banners: [],
  }
}

export const DEFAULT_UPLOAD_CTA: UploadCtaSettings = {
  enabled: false,
  perArticle: UPLOAD_CTA_DEFAULT_PER_ARTICLE,
  items: [],
}

/** ค่าเริ่มต้นตอนสลับไปโหมด "ออกแบบเอง" ครั้งแรก — ยึดสีธีมบทความเป็นฐาน (เหมือนหน้า Clients) */
export function defaultUploadCtaCustom(theme: string, border?: string): CtaCustomDesign {
  return {
    boxBg: theme,
    boxText: '#ffffff',
    boxBorderColor: border || '#e2e8f0',
    boxBorderWidth: 0,
    boxRadius: 16,
    buttonBg: '#ffffff',
    buttonText: theme,
    buttonBorderColor: 'transparent',
    buttonRadius: 10,
  }
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const COLOR_RE = /^(#[0-9a-f]{3,8}|transparent|rgba?\([\d\s.,%]+\))$/i
const color = (v: unknown, fb: string): string => (typeof v === 'string' && COLOR_RE.test(v.trim()) ? v.trim() : fb)
const num = (v: unknown, min: number, max: number, fb: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fb
/** รูปที่รับ: data:image (อัปโหลดจากเครื่อง) หรือ https */
const imageSrc = (v: unknown): string => {
  const s = typeof v === 'string' ? v.trim() : ''
  if (/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(s)) return s
  if (/^https:\/\/[^\s"'<>]+$/i.test(s)) return s.slice(0, 2000)
  return ''
}

const ID_RE = /[^a-z0-9-]+/g
function sanitizeId(v: unknown, fallback: string, used: Set<string>): string {
  let base = typeof v === 'string' ? v.toLowerCase().replace(ID_RE, '').slice(0, 64) : ''
  if (!base) base = fallback
  let id = base
  let n = 2
  while (used.has(id)) {
    id = `${base}-${n}`
    n++
  }
  used.add(id)
  return id
}

/** อ่าน/ตรวจค่า CTA 1 แบบ — ค่าเพี้ยนตกกลับเป็นค่าเริ่มต้น */
function readCtaItem(raw: unknown, index: number, used: Set<string>): UploadCtaItem | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const mode: CtaMode = r.mode === 'custom' || r.mode === 'banner' ? r.mode : 'buttons'

  const seen = new Set<string>()
  const channels: UploadCtaChannel[] = []
  for (const c of Array.isArray(r.channels) ? r.channels : []) {
    if (!c || typeof c !== 'object') continue
    const o = c as Record<string, unknown>
    const type = UPLOAD_CTA_CHANNEL_TYPES.includes(o.type as UploadCtaChannelType) ? (o.type as UploadCtaChannelType) : null
    if (!type || seen.has(type)) continue
    seen.add(type)
    const ch: UploadCtaChannel = { type, label: str(o.label, 60), value: str(o.value, 500) }
    const icon = str(o.icon, 8)
    if (icon) ch.icon = icon
    const img = imageSrc(o.imageUrl)
    if (img) ch.imageUrl = img
    if (o.buttonStyle === 'filled' || o.buttonStyle === 'outline' || o.buttonStyle === 'ghost') ch.buttonStyle = o.buttonStyle
    channels.push(ch)
  }

  const banners: CtaBanner[] = []
  for (const b of Array.isArray(r.banners) ? r.banners : []) {
    if (!b || typeof b !== 'object' || banners.length >= UPLOAD_CTA_MAX_BANNERS) continue
    const o = b as Record<string, unknown>
    banners.push({ id: str(o.id, 64) || `b${banners.length + 1}`, imageUrl: imageSrc(o.imageUrl), href: str(o.href, 1000), alt: str(o.alt, 200) })
  }

  const id = sanitizeId(r.id, `cta-${index}`, used)
  const name = str(r.name, 60) || `CTA ${index}`

  const out: UploadCtaItem = {
    id,
    name,
    mode,
    headline: typeof r.headline === 'string' ? r.headline.slice(0, 200) : DEFAULT_CTA_HEADLINE,
    subtext: typeof r.subtext === 'string' ? r.subtext.slice(0, 400) : DEFAULT_CTA_SUBTEXT,
    channels,
    alignment: r.alignment === 'left' || r.alignment === 'right' ? r.alignment : 'center',
    buttonLayout: r.buttonLayout === 'column' ? 'column' : 'row',
    banners,
  }
  if (r.custom && typeof r.custom === 'object') {
    const c = r.custom as Record<string, unknown>
    const d = defaultUploadCtaCustom('#2563eb')
    out.custom = {
      boxBg: color(c.boxBg, d.boxBg),
      boxText: color(c.boxText, d.boxText),
      boxBorderColor: color(c.boxBorderColor, d.boxBorderColor),
      boxBorderWidth: num(c.boxBorderWidth, 0, 6, d.boxBorderWidth),
      boxRadius: num(c.boxRadius, 0, 32, d.boxRadius),
      buttonBg: color(c.buttonBg, d.buttonBg),
      buttonText: color(c.buttonText, d.buttonText),
      buttonBorderColor: color(c.buttonBorderColor, d.buttonBorderColor),
      buttonRadius: num(c.buttonRadius, 0, 32, d.buttonRadius),
    }
  }
  return out
}

/** เดารูปแบบเก่า (ก่อนมี items หลายแบบ): มี mode/headline/channels/banners อยู่ระดับบนสุด */
function looksLegacyCta(r: Record<string, unknown>): boolean {
  return r.mode !== undefined || r.headline !== undefined || r.subtext !== undefined
    || Array.isArray(r.channels) || Array.isArray(r.banners) || r.custom !== undefined
}

/** อ่าน/ตรวจค่า CTA จาก pushPrefs (หรือจาก body ที่หน้า UI ส่งมา) — ค่าเพี้ยนตกกลับเป็นค่าเริ่มต้น
 * รองรับข้อมูลเก่า (ก่อนมีหลาย CTA): วัตถุระดับบนสุดที่มี mode/headline ฯลฯ → แปลงเป็น item เดียว */
export function readUploadCta(raw: unknown): UploadCtaSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_UPLOAD_CTA, items: [] }
  const r = raw as Record<string, unknown>

  const enabled = r.enabled === true
  const perArticle = num(r.perArticle, UPLOAD_CTA_MIN_PER_ARTICLE, UPLOAD_CTA_MAX_PER_ARTICLE, UPLOAD_CTA_DEFAULT_PER_ARTICLE)

  let itemsRaw: unknown[]
  if (Array.isArray(r.items)) {
    itemsRaw = r.items
  } else if (looksLegacyCta(r)) {
    itemsRaw = [{ ...r, id: 'cta-1', name: 'CTA 1' }]
  } else {
    itemsRaw = []
  }

  const used = new Set<string>()
  const items: UploadCtaItem[] = []
  for (const raw of itemsRaw) {
    if (items.length >= UPLOAD_CTA_MAX_ITEMS) break
    const item = readCtaItem(raw, items.length + 1, used)
    if (item) items.push(item)
  }

  return { enabled, perArticle, items }
}

/** ลิงก์ที่ยอมให้ขึ้นเว็บ — กัน javascript: และ scheme แปลก ๆ */
export function safeCtaHref(href: string): string {
  const v = (href || '').trim()
  if (/^(https?:|tel:|mailto:|line:|sms:)/i.test(v)) return v
  return ''
}

/** ค่าในช่องทาง → ลิงก์จริง (เบอร์ → tel:, อีเมล → mailto:, www → https://) — ว่าง = ไม่ใช่ลิงก์ */
export function channelHref(ch: UploadCtaChannel): string {
  const v = ch.value.trim()
  if (!v) return ''
  const direct = safeCtaHref(v)
  if (direct) return direct
  if (ch.type === 'phone' || /^\+?[\d\s()-]{6,}$/.test(v)) return `tel:${v.replace(/[^\d+]/g, '')}`
  if (ch.type === 'email' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(v)) return `https://${v.replace(/^\/+/, '')}`
  return ''
}

function usableChannels(item: UploadCtaItem): (UploadCtaChannel & { href: string })[] {
  return item.channels.map((c) => ({ ...c, href: channelHref(c) })).filter((c) => c.href)
}

function usableBanners(item: UploadCtaItem): CtaBanner[] {
  return item.banners.filter((b) => b.imageUrl && safeCtaHref(b.href))
}

/** ตั้งค่าครบพอจะแทรกได้: ปุ่ม/ออกแบบเอง = มีช่องทางที่เป็นลิงก์ได้ ≥ 1 / แบนเนอร์ = มีรูป + ลิงก์ ≥ 1 */
export function isUploadCtaItemReady(item: UploadCtaItem): boolean {
  return item.mode === 'banner' ? usableBanners(item).length > 0 : usableChannels(item).length > 0
}

/** CTA ทั้งหมดที่ตั้งค่าครบพอจะแทรกได้จริง */
export function readyUploadCtaItems(cta: UploadCtaSettings): UploadCtaItem[] {
  return cta.items.filter(isUploadCtaItemReady)
}

export function isUploadCtaReady(cta: UploadCtaSettings): boolean {
  if (!cta.enabled) return false
  return readyUploadCtaItems(cta).length > 0
}

export function uploadCtaSummary(raw: unknown): UploadCtaSummary {
  const cta = readUploadCta(raw)
  const ready = readyUploadCtaItems(cta)
  return {
    enabled: cta.enabled,
    mode: ready[0]?.mode ?? cta.items[0]?.mode ?? 'buttons',
    ready: ready.length > 0,
    count: ready.length,
    perArticle: cta.perArticle,
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function buttonHtml(c: UploadCtaChannel & { href: string }): string {
  const style = c.buttonStyle ?? 'filled'
  const cls = style === 'outline' ? 'content-cta__button content-cta__button--secondary'
    : style === 'ghost' ? 'content-cta__button content-cta__button--ghost'
      : 'content-cta__button'
  const external = /^https?:/i.test(c.href) ? ' target="_blank" rel="noopener"' : ''
  const img = c.imageUrl ? `<img class="content-cta__icon" src="${esc(c.imageUrl)}" alt="">` : ''
  const label = c.label || c.value
  return `<a class="${cls}" href="${esc(c.href)}"${external}>${img}${esc(label)}</a>`
}

/** กล่อง CTA 1 จุด — full = headline + subtext + ทุกช่องทาง / short = headline + ปุ่มแรก
 * ทุกกล่องมีคลาส content-cta--u-<itemId> เพิ่ม ไว้ให้ CSS ของแบบนั้น (โหมดออกแบบเอง) เจาะจงได้ */
export function buildUploadCtaHtml(item: UploadCtaItem, variant: 'full' | 'short', bannerIndex = 0): string {
  const scopedClass = `content-cta--u-${item.id}`
  if (item.mode === 'banner') {
    const banners = usableBanners(item)
    if (!banners.length) return ''
    const b = banners[bannerIndex % banners.length]
    const alt = b.alt || item.headline || 'ติดต่อเรา'
    const external = /^https?:/i.test(b.href) ? ' target="_blank" rel="noopener"' : ''
    return `<div class="content-cta content-cta--banner ${scopedClass}"><a href="${esc(safeCtaHref(b.href))}"${external}><img src="${esc(b.imageUrl)}" alt="${esc(alt)}"></a></div>`
  }
  const chans = usableChannels(item)
  if (!chans.length) return ''
  const mods = [
    scopedClass,
    item.alignment !== 'center' ? `content-cta--${item.alignment}` : '',
    item.buttonLayout === 'column' ? 'content-cta--column' : '',
  ].filter(Boolean).join(' ')
  const buttons = (variant === 'short' ? chans.slice(0, 1) : chans).map(buttonHtml).join('')
  const parts = [`<div class="content-cta${mods ? ` ${mods}` : ''}">`]
  if (item.headline.trim()) parts.push(`<p class="content-cta__headline">${esc(item.headline.trim())}</p>`)
  if (variant === 'full' && item.subtext.trim()) parts.push(`<p class="content-cta__subtext">${esc(item.subtext.trim())}</p>`)
  parts.push(`<div class="content-cta__buttons">${buttons}</div>`, '</div>')
  return parts.join('')
}

export function hasUploadCta(html: string): boolean {
  return /class="content-cta[\s"]/.test(html)
}

export function usableUploadCtaBanners(item: UploadCtaItem): CtaBanner[] {
  return usableBanners(item)
}
