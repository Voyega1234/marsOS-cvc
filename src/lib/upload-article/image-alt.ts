// ─── Upload Article — อ่าน/แก้ alt ของรูปในบทความแบบ string ล้วน ─────────────
// ใช้ทั้งฝั่ง client (แผง "รูปในบทความ" แท็บ Review) และ API PATCH — นับลำดับ <img> ด้วย regex เดียวกัน
// ทั้งสองฝั่งจึงชี้รูปเดียวกันเสมอ (data URI ไม่มี ">" อยู่ข้างใน regex จึงไม่ตัดกลางแท็ก)

const IMG_TAG_RE = /<img\b[^>]*>/gi

export type ArticleImage = { index: number; src: string; alt: string; isCover: boolean }

function attr(tag: string, name: string): string {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag)
  return m ? (m[2] ?? m[3] ?? '') : ''
}

function decodeAttr(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

function encodeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function withAlt(tag: string, alt: string): string {
  const value = `alt="${encodeAttr(alt)}"`
  if (/\balt\s*=\s*("[^"]*"|'[^']*')/i.test(tag)) return tag.replace(/\balt\s*=\s*("[^"]*"|'[^']*')/i, value)
  return tag.replace(/^<img\b/i, `<img ${value}`)
}

/** รูปทั้งหมดในบทความตามลำดับ — isCover = อยู่ใน figure ของภาพปก (content-cover) */
export function listArticleImages(html: string): ArticleImage[] {
  const out: ArticleImage[] = []
  let m: RegExpExecArray | null
  let i = 0
  const re = new RegExp(IMG_TAG_RE.source, 'gi')
  while ((m = re.exec(html))) {
    const before = html.slice(Math.max(0, m.index - 200), m.index)
    const isCover = /<figure[^>]*content-cover[^>]*>\s*$/i.test(before)
    out.push({ index: i++, src: decodeAttr(attr(m[0], 'src')), alt: decodeAttr(attr(m[0], 'alt')), isCover })
  }
  return out
}

/** ตั้ง alt ให้รูปลำดับที่ index — คืน html ใหม่ + src ของรูปนั้น (ไม่เจอ = null) */
export function setImageAltAt(html: string, index: number, alt: string): { html: string; src: string } | null {
  let i = 0
  let src: string | null = null
  const next = html.replace(new RegExp(IMG_TAG_RE.source, 'gi'), (tag) => {
    if (i++ !== index) return tag
    src = attr(tag, 'src')
    return withAlt(tag, alt)
  })
  return src === null ? null : { html: next, src }
}

/** ตั้ง alt ให้ทุกรูปที่ src ตรงกัน (ใช้กับต้นฉบับ sourceHtml ให้ Generate ใหม่แล้ว alt ไม่หาย) */
export function setImageAltBySrc(html: string, rawSrc: string, alt: string): string {
  if (!rawSrc) return html
  return html.replace(new RegExp(IMG_TAG_RE.source, 'gi'), (tag) => (attr(tag, 'src') === rawSrc ? withAlt(tag, alt) : tag))
}
