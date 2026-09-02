/**
 * กล่องผู้เขียนท้ายบทความ (Author Card)
 *
 * โครง HTML ชุดเดียวทุกแบบ — ต่างกันแค่ class modifier บน root (.content-author--*)
 * และ CSS ที่ระบบ compile ให้ ทำให้:
 *  - เปลี่ยนสไตล์ = เปลี่ยน class เดียว ไม่ต้องแก้ parser/detector ที่อื่น
 *  - ค่าธีมราย element ('author' ใน Article Lab) ยังคุม .content-author ได้เหมือนเดิม
 *
 * ห้ามใส่ inline style ในบทความ (Component Standard) — สีทั้งหมดมาจาก buildAuthorCardCss
 */

export type AuthorCardStyle = 'profile' | 'banner' | 'byline'

export const DEFAULT_AUTHOR_CARD_STYLE: AuthorCardStyle = 'profile'

export const AUTHOR_CARD_STYLES: Array<{
  key: AuthorCardStyle
  label: string
  description: string
}> = [
  {
    key: 'profile',
    label: 'Profile Card',
    description: 'หัวข้อ "ผู้เขียนบทความ" + การ์ดขาวมีเงา รูปกลม ชื่อเด่น และรายการวุฒิ/ประสบการณ์ติดเครื่องหมายถูก',
  },
  {
    key: 'banner',
    label: 'Banner',
    description: 'แถบสีธีมเต็มความกว้าง รูปกลมขอบขาว ชื่อและวุฒิเป็นตัวอักษรสีขาวบนแถบ',
  },
  {
    key: 'byline',
    label: 'Byline',
    description: 'แถวเดียวเรียบ ๆ รูปเล็ก + ชื่อ + ตำแหน่ง เหมาะกับบทความสั้นที่ไม่อยากให้ท้ายบทความหนัก',
  },
]

export function normalizeAuthorCardStyle(v: unknown): AuthorCardStyle {
  return v === 'banner' || v === 'byline' || v === 'profile' ? v : DEFAULT_AUTHOR_CARD_STYLE
}

/** อ่านสไตล์การ์ดจาก Project.themeColors (JSON) — ไม่ได้ตั้ง = ค่า default ของระบบ */
export function readAuthorCardStyle(themeColorsJson: string | null | undefined): AuthorCardStyle {
  try {
    const parsed = JSON.parse(themeColorsJson || '{}') as Record<string, unknown>
    return normalizeAuthorCardStyle(parsed.authorCard)
  } catch {
    return DEFAULT_AUTHOR_CARD_STYLE
  }
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface AuthorCardInput {
  name: string
  title: string
  /** base64 data URL หรือ URL รูปโปรไฟล์ */
  image?: string
  /** วุฒิ/ใบรับรอง/ประสบการณ์ — บรรทัดละข้อ แสดงเป็นรายการติดเครื่องหมายถูก */
  credentials?: string[]
  style?: AuthorCardStyle
  /** หัวข้อเหนือการ์ด (แบบ profile) — ค่าเริ่มต้นภาษาไทย */
  heading?: string
}

/**
 * สร้าง HTML กล่องผู้เขียน — คืน '' ถ้าไม่มีทั้งชื่อและตำแหน่ง
 * ไม่มีปุ่ม CTA ในกล่องนี้ทุกแบบ (คำสั่งเจ้าของระบบ 2026-09-02): CTA เป็นคนละ component
 */
export function buildAuthorCardHtml(input: AuthorCardInput): string {
  const name = (input.name ?? '').trim()
  const title = (input.title ?? '').trim()
  if (!name && !title) return ''

  const style = normalizeAuthorCardStyle(input.style)
  const image = (input.image ?? '').trim()
  const credentials = (input.credentials ?? []).map(c => c.trim()).filter(Boolean)
  const heading = (input.heading ?? 'ผู้เขียนบทความ').trim()

  const avatar = image
    ? `<img class="content-author__avatar" src="${escapeHtml(image)}" alt="${escapeHtml(name || title)}">`
    : ''
  const credentialItems = credentials.length
    ? `\n      <ul class="content-author__credentials">${credentials
        .map(c => `\n        <li>${escapeHtml(c)}</li>`)
        .join('')}\n      </ul>`
    : ''

  return `
<section class="content-author content-author--${style}">
  ${heading ? `<p class="content-author__heading">${escapeHtml(heading)}</p>` : ''}
  <div class="content-author__card">
    ${avatar}
    <div class="content-author__body">
      ${name ? `<span class="content-author__name">${escapeHtml(name)}</span>` : ''}
      ${title ? `<span class="content-author__title">${escapeHtml(title)}</span>` : ''}${credentialItems}
    </div>
  </div>
</section>`
}

/** ไอคอนถูกในวงกลม — ฝังเป็น data URI ใน CSS (บทความห้ามมี <svg> ที่ไม่ได้มาตรฐาน) */
function checkIcon(color: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'>` +
    `<circle cx='10' cy='10' r='9' fill='none' stroke='${color}' stroke-width='1.6'/>` +
    `<path d='M5.8 10.3l2.7 2.7 5.7-5.7' fill='none' stroke='${color}' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'/>` +
    `</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

/**
 * CSS ของกล่องผู้เขียนทั้ง 3 แบบ — ใส่ทุกแบบเสมอ เพราะบทความเก่าที่เขียนไว้ก่อน
 * เปลี่ยนสไตล์ยังถือ class เดิมอยู่ ถ้าใส่เฉพาะแบบที่เลือก บทความเก่าจะกลายเป็นกล่องเปล่า
 */
export function buildAuthorCardCss(c: {
  theme: string
  text: string
  border: string
  accent: string
}): string[] {
  const { theme, text, border, accent } = c
  const check = checkIcon(accent)
  const checkOnDark = checkIcon('#ffffff')
  const lines: string[] = []

  // โครงร่วมทุกแบบ
  lines.push(`.content-article .content-author{margin-top:2.6em;display:block;}`)
  lines.push(`.content-article .content-author__heading{margin:0 0 1em;text-align:center;font-weight:800;font-size:1.5em;color:${theme};}`)
  lines.push(`.content-article .content-author__card{display:flex;align-items:center;gap:22px;}`)
  lines.push(`.content-article .content-author__avatar{width:104px;height:104px;border-radius:50%;object-fit:cover;flex-shrink:0;}`)
  lines.push(`.content-article .content-author__body{flex:1;min-width:0;}`)
  lines.push(`.content-article .content-author__name{display:block;font-weight:800;font-size:1.25em;line-height:1.4;color:${theme};}`)
  lines.push(`.content-article .content-author__title{display:block;font-size:.92em;opacity:.7;margin-top:.15em;}`)
  lines.push(`.content-article .content-author__credentials{list-style:none;margin:.75em 0 0;padding:0;display:grid;gap:.5em;}`)
  lines.push(`.content-article .content-author__credentials li{position:relative;padding-left:1.9em;margin:0;font-size:.95em;line-height:1.5;color:${text};}`)
  lines.push(`.content-article .content-author__credentials li::before{content:"";position:absolute;left:0;top:.15em;width:1.25em;height:1.25em;background:${check} center/contain no-repeat;}`)

  // 1) Profile — การ์ดขาวมีเงา (ค่าเริ่มต้นของระบบ)
  lines.push(`.content-article .content-author--profile .content-author__card{background:#fff;border:1px solid ${border};border-radius:20px;padding:1.6em 1.8em;box-shadow:0 10px 30px rgba(15,23,42,.07);}`)
  lines.push(`.content-article .content-author--profile .content-author__avatar{border:6px solid color-mix(in srgb, ${border} 45%, #fff);}`)

  // 2) Banner — แถบสีธีมเต็มความกว้าง
  lines.push(`.content-article .content-author--banner .content-author__heading{color:inherit;}`)
  lines.push(`.content-article .content-author--banner .content-author__card{background:${theme};border-radius:18px;padding:1.5em 1.7em;}`)
  lines.push(`.content-article .content-author--banner .content-author__avatar{width:88px;height:88px;border:4px solid #ffffff;}`)
  lines.push(`.content-article .content-author--banner .content-author__name{color:#fff;}`)
  lines.push(`.content-article .content-author--banner .content-author__title{color:#fff;opacity:.85;}`)
  lines.push(`.content-article .content-author--banner .content-author__credentials li{color:#fff;}`)
  lines.push(`.content-article .content-author--banner .content-author__credentials li::before{background-image:${checkOnDark};}`)

  // 3) Byline — แถวเดียวเรียบ
  lines.push(`.content-article .content-author--byline .content-author__heading{display:none;}`)
  lines.push(`.content-article .content-author--byline .content-author__card{gap:16px;padding:1.2em 1.4em;border-top:2px solid ${border};background:color-mix(in srgb, ${border} 22%, transparent);border-radius:12px;}`)
  lines.push(`.content-article .content-author--byline .content-author__avatar{width:56px;height:56px;}`)
  lines.push(`.content-article .content-author--byline .content-author__name{font-size:1em;font-weight:700;color:inherit;}`)
  lines.push(`.content-article .content-author--byline .content-author__title{font-size:.85em;opacity:.65;}`)
  lines.push(`.content-article .content-author--byline .content-author__credentials{display:none;}`)

  // บทความเก่าที่เขียนก่อนมีระบบเลือกสไตล์ — โครงเดิมคือ <div class="content-author"><img>…
  // ไม่มี class modifier และไม่มี .content-author__avatar จึงต้องคงสไตล์เดิมไว้ให้ไม่พัง
  lines.push(`.content-article .content-author:not([class*="content-author--"]){display:flex;align-items:center;gap:16px;padding:1.2em 1.4em;border-top:2px solid ${border};background:color-mix(in srgb, ${border} 22%, transparent);border-radius:12px;}`)
  lines.push(`.content-article .content-author:not([class*="content-author--"]) > img{width:56px;height:56px;border-radius:50%;object-fit:cover;flex-shrink:0;}`)
  lines.push(`.content-article .content-author:not([class*="content-author--"]) .content-author__name{font-size:1em;font-weight:700;color:inherit;}`)
  lines.push(`.content-article .content-author:not([class*="content-author--"]) .content-author__title{font-size:.85em;opacity:.65;}`)

  // มือถือ: รูปอยู่บน ข้อความอยู่ล่าง
  lines.push(`@media (max-width:520px){.content-article .content-author__card{flex-direction:column;align-items:center;text-align:center;}.content-article .content-author__credentials li{text-align:left;}}`)

  return lines
}
