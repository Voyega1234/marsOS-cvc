// ─── Upload Article — อ่าน/แก้ alt ของรูปในบทความแบบ string ล้วน ─────────────
// ใช้ทั้งฝั่ง client (แผง "รูปในบทความ" แท็บ Review) และ API PATCH — นับลำดับ <img> ด้วย regex เดียวกัน
// ทั้งสองฝั่งจึงชี้รูปเดียวกันเสมอ (data URI ไม่มี ">" อยู่ข้างใน regex จึงไม่ตัดกลางแท็ก)

const IMG_TAG_RE = /<img\b[^>]*>/gi

export type ArticleImage = { index: number; src: string; alt: string; href: string; isCover: boolean }

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
    const wrap = linkWrap(html, m.index, m.index + m[0].length)
    const href = wrap ? decodeAttr(attr(html.slice(wrap.openStart, wrap.openEnd), 'href')) : ''
    out.push({ index: i++, src: decodeAttr(attr(m[0], 'src')), alt: decodeAttr(attr(m[0], 'alt')), href, isCover })
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

type ImgMatch = { index: number; start: number; end: number; tag: string }

function imgMatches(html: string): ImgMatch[] {
  const out: ImgMatch[] = []
  const re = new RegExp(IMG_TAG_RE.source, 'gi')
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(html))) out.push({ index: i++, start: m.index, end: m.index + m[0].length, tag: m[0] })
  return out
}

/** <a ...> ที่ห่อรูปนี้ไว้ตรง ๆ (มีแค่รูปข้างใน) — ไม่มี = null */
function linkWrap(html: string, imgStart: number, imgEnd: number): { openStart: number; openEnd: number; closeStart: number; closeEnd: number } | null {
  const before = /<a\b[^>]*>\s*$/i.exec(html.slice(Math.max(0, imgStart - 2000), imgStart))
  const after = /^\s*<\/a\s*>/i.exec(html.slice(imgEnd, imgEnd + 50))
  if (!before || !after) return null
  const openStart = imgStart - before[0].length
  return { openStart, openEnd: openStart + before[0].replace(/\s*$/, '').length, closeStart: imgEnd, closeEnd: imgEnd + after[0].length }
}

/** ใส่/เปลี่ยน/เอาลิงก์ออกจากรูปเดียว (href ว่าง = เอาลิงก์ออก) */
function applyLink(html: string, m: ImgMatch, href: string): string {
  const wrap = linkWrap(html, m.start, m.end)
  if (wrap) {
    if (!href) return html.slice(0, wrap.openStart) + m.tag + html.slice(wrap.closeEnd)
    const open = html.slice(wrap.openStart, wrap.openEnd)
    const nextOpen = /\bhref\s*=\s*("[^"]*"|'[^']*')/i.test(open)
      ? open.replace(/\bhref\s*=\s*("[^"]*"|'[^']*')/i, `href="${encodeAttr(href)}"`)
      : open.replace(/^<a\b/i, `<a href="${encodeAttr(href)}"`)
    return html.slice(0, wrap.openStart) + nextOpen + html.slice(wrap.openEnd)
  }
  if (!href) return html
  return html.slice(0, m.start) + `<a href="${encodeAttr(href)}">${m.tag}</a>` + html.slice(m.end)
}

/** ตั้งลิงก์ให้รูปลำดับที่ index (กดรูปแล้วไปลิงก์) — คืน html ใหม่ + src ของรูป (ไม่เจอ = null) */
export function setImageLinkAt(html: string, index: number, href: string): { html: string; src: string } | null {
  const m = imgMatches(html).find(x => x.index === index)
  if (!m) return null
  return { html: applyLink(html, m, href), src: attr(m.tag, 'src') }
}

/** ตั้งลิงก์ให้ทุกรูปที่ src ตรงกัน (ใช้กับ sourceHtml) — ทำจากท้ายไปหน้า ตำแหน่งจะได้ไม่เลื่อน */
export function setImageLinkBySrc(html: string, rawSrc: string, href: string): string {
  if (!rawSrc) return html
  let out = html
  for (const m of imgMatches(html).filter(x => attr(x.tag, 'src') === rawSrc).reverse()) out = applyLink(out, m, href)
  return out
}
