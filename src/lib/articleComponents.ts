/**
 * Component Standard ของบทความ
 *
 * แก้ปัญหาจาก feedback PSEO (2026-08-19):
 * 1. บทความห้ามฝัง inline style — เขียนเฉพาะ semantic HTML + class มาตรฐาน `content-*`
 * 2. component ชนิดเดียวกันใช้โครง HTML เดียวกันทุกบทความ → คุมด้วย Global CSS ได้
 * 3. สี/ฟอนต์จาก Article Lab ถูก compile เป็น CSS ชุดเดียวแบบ deterministic
 *    (ไม่ให้ AI ทาสีเอง) — แนบเป็น <style> ในบทความ (โหมด embed) หรือให้ดาวน์โหลด
 *    ไปติดในธีมครั้งเดียว (โหมด clean)
 *
 * ห้ามเปลี่ยนชื่อ class โดยไม่อัพเดต: write prompt, articleCards parser,
 * push/scan detector และ CSS builder ในไฟล์นี้ให้ครบกันเสมอ
 */
import type { ArticleElementStyles } from '@/lib/articleTheme'

export type ArticleStyleMode = 'embed' | 'clean'

// ── Spec ที่ส่งเข้า prompt ตอนเขียนบทความ ─────────────────────────────────────

export const MARS_COMPONENT_SPEC = `
==================================================
COMPONENT STANDARD (บังคับ — โครง HTML ต้องตรงนี้ทุกบทความ)
==================================================
กติกาเหล็ก:
1. ห้ามใส่ style="..." (inline style) ทุกกรณี
2. ห้ามใส่แท็ก <style> — ระบบใส่ CSS ให้เองภายหลัง
3. ห้ามตั้ง class เอง — ใช้เฉพาะ class มาตรฐานด้านล่างนี้เท่านั้น
   (element พื้นฐาน h2-h6, p, ul/ol/li, strong, a ไม่ต้องมี class)
4. component ชนิดเดียวกันใช้โครงเดียวกันเสมอ ห้ามดัดแปลง

หัวข้อ section (สำหรับสารบัญ): ทุก <h2> ต้องมี id ภาษาอังกฤษ เช่น <h2 id="what-is-x">

CTA (กล่องชวนติดต่อ — เบอร์/ลิงก์ด้านล่างเป็นตัวอย่างสมมติ ห้ามใช้จริง ให้ใช้ข้อมูลจากบล็อก CTA เท่านั้น):
<div class="content-cta">
  <p class="content-cta__headline">ข้อความชวน</p>
  <p class="content-cta__subtext">รายละเอียดสั้น ๆ</p>
  <div class="content-cta__buttons">
    <a class="content-cta__button" href="tel:0812345678">โทร 081-234-5678</a>
    <a class="content-cta__button content-cta__button--secondary" href="https://line.me/...">LINE</a>
  </div>
</div>

FAQ (ใช้ <details> — กดเปิด/ปิดได้โดยไม่ต้องมี JavaScript, ห้ามมี wrapper ครอบ):
<h2 id="faq">คำถามที่พบบ่อย</h2>
<details class="content-faq__item">
  <summary class="content-faq__question">คำถาม?</summary>
  <div class="content-faq__answer"><p>คำตอบ</p></div>
</details>

รูปภาพ:
<figure class="content-figure">
  <img src="..." alt="คำบรรยายรูปที่บรรยายภาพจริง">
  <figcaption>คำอธิบายรูป (ถ้ามี)</figcaption>
</figure>

ตาราง (ต้องมี wrapper กันตารางล้นจอมือถือ):
<div class="content-table-wrap"><table class="content-table">...</table></div>

กล่องเน้นข้อความสำคัญ:
<div class="content-highlight"><p>ประเด็นสำคัญ</p></div>

กล่องคำเตือน/ข้อควรระวัง:
<div class="content-notice"><p>คำเตือน</p></div>

ข้อดี-ข้อเสีย:
<div class="content-pros-cons">
  <div class="content-pros"><h4>ข้อดี</h4><ul><li>...</li></ul></div>
  <div class="content-cons"><h4>ข้อควรพิจารณา</h4><ul><li>...</li></ul></div>
</div>

คำพูดอ้างอิง:
<blockquote class="content-quote"><p>...</p></blockquote>
`

// ── CSS builder — compile ค่าจาก Article Lab เป็น stylesheet เดียว ─────────────

export interface ArticleCssOptions {
  themeColor: string      // headings, CTA background
  textColor: string       // body text
  borderColor: string     // เส้นแบ่ง/กรอบ
  accentColor: string     // links, ปุ่มรอง
  backgroundColor: string // พื้นหลังบทความ ('' หรือ transparent = ใช้ของธีมเว็บ)
  elementStyles?: ArticleElementStyles | null
  typography?: {
    fontFamily?: string | null; fontSize?: string | null; lineHeight?: string | null
    letterSpacing?: string | null; headingFont?: string | null; headingWeight?: string | null
    paragraphMargin?: string | null
  } | null
}

const ELEMENT_SELECTOR: Record<string, string> = {
  h1: '.content-article h1',
  h2: '.content-article h2',
  h3: '.content-article h3',
  h4: '.content-article h4',
  h5: '.content-article h5',
  h6: '.content-article h6',
  body: '.content-article p, .content-article li',
  link: '.content-article a',
  author: '.content-article .content-author',
  faq: '.content-article .content-faq__item',
}

export function buildArticleCss(opts: ArticleCssOptions): string {
  const t = opts.typography
  const theme = opts.themeColor || '#1d48f3'
  const text = opts.textColor || '#000000'
  const border = opts.borderColor || '#e2e8f0'
  const accent = opts.accentColor || theme
  const bg = opts.backgroundColor && opts.backgroundColor !== '#ffffff' ? opts.backgroundColor : ''

  // Default typography — IBM Plex Sans Thai (เจ้าของเลือกจากหน้าเทียบ 2026-08-19)
  // ใช้เมื่อ client ไม่ได้ตั้งฟอนต์เองใน Article Lab — ตั้งเองเมื่อไหร่ค่านั้นชนะ
  const GOOGLE_DEFAULT_STACK = "'IBM Plex Sans Thai','Noto Sans Thai',sans-serif"
  const useGoogleDefault = !t?.fontFamily

  // ฟอนต์จาก element styles → @import ครั้งเดียว
  const fonts = new Set<string>()
  for (const st of Object.values(opts.elementStyles ?? {})) {
    if (st?.font) fonts.add(st.font)
  }
  if (useGoogleDefault) { fonts.add('IBM Plex Sans Thai'); fonts.add('Noto Sans Thai') }
  const importLine = fonts.size > 0
    ? `@import url('https://fonts.googleapis.com/css2?${Array.from(fonts).map(f => `family=${f.replace(/ /g, '+')}:wght@400;500;700`).join('&')}&display=swap');\n`
    : ''

  const lines: string[] = []
  lines.push(`.content-article{${bg ? `background:${bg};` : ''}color:${text};font-family:${t?.fontFamily || GOOGLE_DEFAULT_STACK};${t?.fontSize ? `font-size:${t.fontSize};` : ''}line-height:${t?.lineHeight || '1.7'};${t?.letterSpacing && t.letterSpacing !== 'normal' ? `letter-spacing:${t.letterSpacing};` : ''}}`)
  lines.push(`.content-article h1,.content-article h2,.content-article h3,.content-article h4,.content-article h5,.content-article h6{color:${theme};${t?.headingFont ? `font-family:${t.headingFont};` : ''}font-weight:${t?.headingWeight || '700'};line-height:1.35;margin:1.6em 0 .6em;}`)
  lines.push(`.content-article h1{margin-top:0;}`)
  lines.push(`.content-article p{margin:0 0 ${t?.paragraphMargin || '1.2em'};}`)
  lines.push(`.content-article a{color:${accent};text-decoration:underline;text-underline-offset:2px;}`)
  lines.push(`.content-article img{max-width:100%;height:auto;}`)

  // Components
  lines.push(`.content-article .content-figure{margin:2.2em 0;text-align:center;}`)
  lines.push(`.content-article .content-figure img{border-radius:12px;}`)
  lines.push(`.content-article .content-figure figcaption{margin-top:.6em;font-size:.85em;opacity:.65;}`)
  lines.push(`.content-article .content-table-wrap{overflow-x:auto;margin:1.6em 0;}`)
  lines.push(`.content-article .content-table{width:100%;border-collapse:collapse;font-size:.95em;}`)
  lines.push(`.content-article .content-table th{background:${theme};color:#fff;text-align:left;padding:.65em .9em;}`)
  lines.push(`.content-article .content-table td{border:1px solid ${border};padding:.6em .9em;vertical-align:top;}`)
  lines.push(`.content-article .content-highlight{border-left:4px solid ${theme};background:color-mix(in srgb, ${theme} 7%, transparent);padding:1em 1.2em;border-radius:0 10px 10px 0;margin:1.6em 0;}`)
  lines.push(`.content-article .content-notice{border:1px solid #f59e0b55;background:#f59e0b12;padding:1em 1.2em;border-radius:10px;margin:1.6em 0;}`)
  lines.push(`.content-article .content-quote{border-left:4px solid ${border};margin:1.6em 0;padding:.4em 1.2em;font-style:italic;opacity:.85;}`)
  lines.push(`.content-article .content-pros-cons{display:grid;grid-template-columns:1fr 1fr;gap:1em;margin:1.6em 0;}`)
  lines.push(`@media(max-width:640px){.content-article .content-pros-cons{grid-template-columns:1fr;}}`)
  lines.push(`.content-article .content-pros,.content-article .content-cons{border:1px solid ${border};border-radius:12px;padding:1em 1.2em;}`)
  lines.push(`.content-article .content-pros h4{color:#059669;margin-top:0;}`)
  lines.push(`.content-article .content-cons h4{color:#d97706;margin-top:0;}`)

  // TOC (ระบบ generate ให้)
  lines.push(`.content-article .content-toc{border:1px solid ${border};border-radius:12px;padding:1em 1.4em;margin:1.6em 0;}`)
  lines.push(`.content-article .content-toc ol{margin:.5em 0 0;padding-left:1.2em;}`)
  lines.push(`.content-article .content-toc a{text-decoration:none;}`)

  // CTA
  lines.push(`.content-article .content-cta{background:${theme};color:#fff;border-radius:16px;padding:1.6em;margin:2.2em 0;text-align:center;}`)
  lines.push(`.content-article .content-cta__headline{font-size:1.25em;font-weight:700;margin:0 0 .3em;color:#fff;}`)
  lines.push(`.content-article .content-cta__subtext{margin:0 0 1em;opacity:.85;color:#fff;}`)
  lines.push(`.content-article .content-cta__buttons{display:flex;gap:.7em;justify-content:center;flex-wrap:wrap;}`)
  lines.push(`.content-article .content-cta__button{display:inline-block;background:#fff;color:${theme};font-weight:700;padding:.65em 1.5em;border-radius:10px;text-decoration:none;}`)
  lines.push(`.content-article .content-cta__button--secondary{background:transparent;color:#fff;border:1.5px solid #ffffff88;}`)

  // FAQ (details/summary)
  lines.push(`.content-article .content-faq__item{border:1px solid ${border};border-radius:12px;margin:.7em 0;overflow:hidden;}`)
  lines.push(`.content-article .content-faq__question{cursor:pointer;list-style:none;font-weight:600;padding:.9em 1.2em;display:flex;justify-content:space-between;align-items:center;gap:1em;}`)
  lines.push(`.content-article .content-faq__question::-webkit-details-marker{display:none;}`)
  lines.push(`.content-article .content-faq__question::after{content:"+";font-weight:700;color:${theme};flex-shrink:0;}`)
  lines.push(`.content-article .content-faq__item[open] .content-faq__question::after{content:"−";}`)
  lines.push(`.content-article .content-faq__answer{padding:0 1.2em .9em;}`)

  // Author box
  lines.push(`.content-article .content-author{display:flex;align-items:center;gap:16px;padding:1.2em 1.4em;margin-top:2.4em;border-top:2px solid ${border};background:color-mix(in srgb, ${border} 22%, transparent);border-radius:12px;}`)
  lines.push(`.content-article .content-author img{width:56px;height:56px;border-radius:50%;object-fit:cover;flex-shrink:0;}`)
  lines.push(`.content-article .content-author__name{font-weight:700;display:block;}`)
  lines.push(`.content-article .content-author__title{font-size:.85em;opacity:.65;display:block;}`)

  // ค่าราย element จาก Article Lab ทับท้ายสุด (ชนะค่า default ข้างบน)
  const fontFallback = "', sans-serif"
  for (const [key, st] of Object.entries(opts.elementStyles ?? {})) {
    if (!st || (!st.color && !st.background && !st.font)) continue
    const sel = ELEMENT_SELECTOR[key]
    if (!sel) continue
    const decls: string[] = []
    if (st.color) decls.push(`color:${st.color}`)
    if (st.background) decls.push(`background-color:${st.background}`)
    if (st.font) decls.push(`font-family:'${st.font}${fontFallback}`)
    lines.push(`${sel}{${decls.join(';')};}`)
  }

  return importLine + lines.join('\n')
}

// ── ประกอบ/ถอดสไตล์ ──────────────────────────────────────────────────────────

/** ครอบเนื้อหาด้วย wrapper มาตรฐาน + แนบ CSS (โหมด embed) — idempotent */
export function wrapArticleHtml(html: string, css: string | null): string {
  let body = html.trim()
  // ถ้ามี wrapper อยู่แล้ว (เช่น regenerate) ถอดของเดิมก่อน
  const wrapped = body.match(/^([\s\S]*?)<div class="content-article">([\s\S]*)<\/div>\s*$/)
  if (wrapped && !wrapped[1].includes('<div class="content-article">')) {
    body = (wrapped[1] + wrapped[2]).trim()
  }
  body = stripStyleTags(body)
  const styleBlock = css ? `<style>\n${css}\n</style>\n` : ''
  return `${styleBlock}<div class="content-article">\n${body}\n</div>`
}

/** ตัดแท็ก <style> ทั้งหมด (ใช้ตอน push โหมด clean และกัน AI แอบใส่มา) */
export function stripStyleTags(html: string): string {
  return html.replace(/<style\b[\s\S]*?<\/style>\s*/gi, '')
}

/** ตัด <h1> ตัวแรก — สำหรับเว็บที่แสดง H1 จาก post title อยู่แล้ว */
export function stripLeadingH1(html: string): string {
  return html.replace(/<h1\b[^>]*>[\s\S]*?<\/h1>\s*/i, '')
}
