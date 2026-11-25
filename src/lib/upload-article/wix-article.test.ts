/**
 * เทสตัวปรับผลสแกนของเว็บ Wix: ระยะห่างจากบรรทัดว่าง, จุดนำหน้ารายการ, ลิงก์, ฟอนต์ตอน push
 * และยืนยันว่าธีมที่ไม่มีธงของ Wix ได้ CSS เท่าเดิม
 * รัน: npx tsx src/lib/upload-article/wix-article.test.ts
 */
import { adaptWixArticleStyle, wixBlockStats, wixFontPrelude } from '@/lib/upload-article/wix-article'
import { sanitizeThemeDetail, themeDetailCss } from '@/lib/upload-article/theme-css'
import type { UploadArticleStyle } from '@/lib/upload-article/types'

let passed = 0
function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error('FAIL: ' + msg)
  passed++
}

// บล็อกของ Ricos: เนื้อหา แล้วตามด้วยตัวบอกชนิด <div type="…" data-hook="rcv-blockN">
let n = 0
const mark = (type: string) => `<div type="${type}" data-hook="rcv-block${++n}"></div>`
const P = (text = 'ข้อความ') => `<p class="x">${text}</p>${mark('paragraph')}`
const H = () => `<h2 class="x">หัวข้อ</h2>${mark('heading')}`
const E = () => `<div class="x"><br></div>${mark('empty-line')}`
const L = (style = 'margin-inline-start:1.5em;list-style-type:disc') =>
  `<ul class="x"><li dir="auto" aria-level="1" class="y" style="${style}"><p>ข้อ</p></li></ul>${mark('bulleted_list')}`
const wrap = (body: string) => `<div type="first" data-hook="rcv-block-first"></div>${body}<div type="last" data-hook="rcv-block-last"></div>`

// แบบที่เจอบนเว็บจริง: ย่อหน้า/หัวข้อเว้นบรรทัด, ประโยคนำติดรายการ, หลังรายการเว้นบรรทัด
const SPACED = wrap([P(), E(), H(), E(), P(), E(), H(), E(), P(), L(), E(), P(), L(), E(), H(), E(), P(), E()].join(''))
// เว็บที่ไม่เว้นบรรทัดเลย
const TIGHT = wrap([P(), P(), H(), P(), P(), H(), P(), P()].join(''))

// ผลที่ตัววัดให้กับหน้า Wix: margin 0 ทั้งหมด, list none, ลิงก์ได้จากปุ่ม
const MEASURED: UploadArticleStyle = {
  p: { fontFamily: 'futura-lt-w01-book,sans-serif', fontSize: '18px', fontWeight: 400, lineHeight: '1.5', color: 'rgb(255,255,255)', marginTop: '0px', marginBottom: '0px' },
  h2: { fontFamily: 'oswald-medium,oswald,sans-serif', fontSize: '28px', fontWeight: 400, marginTop: '0px', marginBottom: '0px' },
  h3: { fontFamily: 'oswald-medium,oswald,sans-serif', fontSize: '22px', marginBottom: '0px' },
  ul: { margin: '0px', padding: '0px' },
  li: { listStyle: 'none', paddingLeft: '0px', marginLeft: '0px' },
  link: { color: 'rgb(255,255,255)', decoration: 'none', fontWeight: 700 },
  strong: { fontFamily: 'futura-lt-w01-book,sans-serif', fontWeight: 700, color: 'rgb(255,255,255)' },
}

function main() {
  // ── นับบล็อก ─────────────────────────────────────────────────────────────
  const stats = wixBlockStats(SPACED)
  assert(stats.paragraph.spaced === 3 && stats.paragraph.tight === 0, `ย่อหน้าเว้นบรรทัด (${JSON.stringify(stats.paragraph)})`)
  assert(stats.heading.spaced === 3 && stats.heading.tight === 0, 'หัวข้อเว้นบรรทัด')
  assert(stats.list.spaced === 2, 'รายการเว้นบรรทัด')
  assert(stats.listLead.tight === 2 && stats.listLead.spaced === 0, 'ประโยคนำติดรายการ')
  assert(stats.emptyLines === 8, 'จำนวนบรรทัดว่าง')
  assert(wixBlockStats('<p>ไม่มีตัวบอกชนิด</p>').emptyLines === 0, 'HTML ที่ไม่ใช่ Ricos = ไม่มีอะไรให้นับ')

  // ── ระยะห่าง = บรรทัดว่าง 1 บรรทัด (18px × 1.5 = 27px) ──────────────────────
  const a = adaptWixArticleStyle({ article: MEASURED, html: SPACED, linkColor: '#41b9d5' })
  assert(a.p?.marginBottom === '27px', `ย่อหน้าเว้น 27px (${a.p?.marginBottom})`)
  assert(a.h2?.marginBottom === '27px' && a.h3?.marginBottom === '27px', 'หัวข้อเว้น 27px')
  assert(a.h4 === undefined || a.h4.marginBottom === '27px', 'h4 ที่ไม่มีค่าเดิมได้ระยะเดียวกัน')
  assert(a.ul?.margin === '0 0 27px', `รายการเว้นด้านล่าง (${a.ul?.margin})`)
  assert(a.p?.fontSize === '18px' && a.h2?.fontFamily === MEASURED.h2?.fontFamily, 'ค่าที่วัดได้จริงไม่ถูกแตะ')
  assert(MEASURED.p?.marginBottom === '0px' && MEASURED.li?.listStyle === 'none', 'ไม่แก้ object ต้นทาง')

  // ── รายการ ───────────────────────────────────────────────────────────────
  assert(a.li?.listStyle === 'disc', 'จุดนำหน้าจาก style ของ li')
  assert(a.li?.marginLeft === '1.5em', 'ระยะเยื้องจาก style ของ li')
  assert(a.listTight === true, 'ประโยคนำติดรายการ → listTight')
  assert(a.headingStrongInherit === true, 'ตัวหนาในหัวข้อใช้ฟอนต์หัวข้อ')

  // ── ลิงก์: ไม่มีลิงก์ในย่อหน้า → ใช้สีธีม Wix ไม่ใช่สีปุ่ม ─────────────────────
  assert(a.link?.color === '#41b9d5' && a.link.decoration === 'none' && a.link.fontWeight === undefined, `ลิงก์ใช้สีธีม (${JSON.stringify(a.link)})`)
  const underlined = adaptWixArticleStyle({ article: MEASURED, html: SPACED, page: '<div style="--ricos-custom-link-text-decoration:underline">', linkColor: '#41b9d5' })
  assert(underlined.link?.decoration === 'underline', 'ขีดเส้นใต้ตามตัวแปรของ Wix')
  const withLink = adaptWixArticleStyle({ article: MEASURED, html: wrap(P('ดู <a href="https://x.test/a" class="q">ที่นี่</a>') + E()), linkColor: '#41b9d5' })
  assert(withLink.link?.color === 'rgb(255,255,255)' && withLink.link.fontWeight === 700, 'มีลิงก์ในย่อหน้าจริง = เชื่อค่าที่วัดได้')

  // ── เว็บที่ไม่เว้นบรรทัด: ไม่เติมระยะ ────────────────────────────────────────
  const tight = adaptWixArticleStyle({ article: MEASURED, html: TIGHT })
  assert(tight.p?.marginBottom === '0px' && tight.h2?.marginBottom === '0px', 'ไม่เว้นบรรทัด = ไม่เติมระยะ')
  assert(tight.listTight === undefined, 'ไม่มีรายการ = ไม่ตั้ง listTight')
  assert(tight.link?.color === undefined, 'ไม่มีสีธีม = ไม่เดาสีลิงก์')

  // ── ค่าที่วัดได้จริงชนะ ───────────────────────────────────────────────────
  const real = adaptWixArticleStyle({
    article: { ...MEASURED, p: { ...MEASURED.p, marginBottom: '12px' }, li: { listStyle: 'square', marginLeft: '2em' }, ul: { margin: '0 0 10px' } },
    html: SPACED,
  })
  assert(real.p?.marginBottom === '12px' && real.li?.listStyle === 'square' && real.li.marginLeft === '2em' && real.ul?.margin === '0 0 10px', 'ค่าที่วัดได้ไม่ใช่ 0 คงไว้')

  // ── ขนาดตัวอักษรไม่ใช่ px = ไม่เดาระยะ ─────────────────────────────────────
  const noPx = adaptWixArticleStyle({ article: { ...MEASURED, p: { ...MEASURED.p, fontSize: '1.1em' } }, html: SPACED })
  assert(noPx.p?.marginBottom === '0px' && noPx.listTight === undefined, 'ไม่รู้ขนาด px = ไม่เติมระยะ')
  assert(noPx.li?.listStyle === 'disc', 'แต่ยังอ่านจุดนำหน้าได้')

  // ── ค่าแปลกใน style ของ li ไม่หลุดเข้า CSS ─────────────────────────────────
  const odd = adaptWixArticleStyle({ article: MEASURED, html: wrap(P() + L('margin-inline-start:calc(1em + 4px);list-style-type:url(x)') + E()) })
  assert(odd.li?.listStyle === 'none' && odd.li.marginLeft === '0px', 'ค่าที่ไม่ตรงรูปแบบถูกข้าม')

  // ── CSS: ธงของ Wix ออกกฎเพิ่ม 2 ข้อ ธีมที่ไม่มีธงได้ CSS เท่าเดิม ───────────────
  const plainCss = themeDetailCss(sanitizeThemeDetail({ source: 'scan', article: MEASURED })!)
  const wixCss = themeDetailCss(sanitizeThemeDetail({ source: 'scan', article: a })!)
  assert(!plainCss.includes(':is(strong,b)') && !plainCss.includes(':has(+ul)'), 'ไม่มีธง = ไม่มีกฎของ Wix')
  assert(/\.content-article :is\(h1,h2,h3,h4,\.content-faq__heading\) :is\(strong,b\)[^{]*\{font-family:inherit;font-weight:inherit;color:inherit;\}/.test(wixCss), 'กฎตัวหนาในหัวข้อ')
  assert(/\.content-article p:not\([^{]*:has\(\+ul\),\.content-article p:not\([^{]*:has\(\+ol\)\{margin-bottom:0;\}/.test(wixCss), 'กฎประโยคนำติดรายการ')
  assert(wixCss.includes('margin-bottom:27px') && wixCss.includes('list-style-type:disc') && wixCss.includes('margin-left:1.5em'), 'ระยะและรายการออกใน CSS')
  assert(wixCss.includes('#41b9d5'), 'สีลิงก์ของธีมออกใน CSS')
  // ธงต้องเป็น true เท่านั้น ค่าอื่นถูกทิ้ง
  const junk = sanitizeThemeDetail({ source: 'scan', article: { ...MEASURED, headingStrongInherit: 'yes', listTight: 1 } as unknown as UploadArticleStyle })!
  assert(junk.article?.headingStrongInherit === undefined && junk.article?.listTight === undefined, 'ธงที่ไม่ใช่ true ถูกทิ้ง')
  assert(themeDetailCss(junk) === plainCss, 'ธงปลอม = CSS เท่าเดิมทุกตัวอักษร')

  // ── ฟอนต์ตอน push เข้า Wix ────────────────────────────────────────────────
  assert(wixFontPrelude(undefined) === null, 'ไม่มีผลสแกน = ไม่แนบอะไร')
  const fonts = wixFontPrelude({
    ...MEASURED,
    fontFaces: [
      { family: 'futura-lt-w01-book', url: 'https://static.parastorage.com/fonts/futura.woff2', format: 'woff2' },
      { family: 'oswald-medium', url: 'https://static.parastorage.com/fonts/oswald.woff2', format: 'woff2' },
      { family: 'not-used', url: 'https://static.parastorage.com/fonts/other.woff2' },
    ],
  })!
  assert(fonts.style.startsWith('<style>@font-face{') && fonts.style.endsWith('</style>'), 'ได้แท็ก style')
  assert(fonts.style.includes('url("https://static.parastorage.com/fonts/futura.woff2")'), 'ลิงก์ไฟล์ตรง ไม่ผ่าน proxy ของระบบ')
  assert(!fonts.style.includes('font-proxy') && !fonts.style.includes('not-used'), 'ไม่ใช้ proxy และไม่แนบฟอนต์ที่ไม่ได้ใช้')
  assert(fonts.warning === undefined, 'ฟอนต์ครบ = ไม่เตือน')
  const lacking = wixFontPrelude({ ...MEASURED, fontFaces: [{ family: 'oswald-medium', url: 'https://static.parastorage.com/fonts/oswald.woff2' }] })!
  assert(!!lacking.warning && lacking.warning.includes('futura-lt-w01-book') && !lacking.warning.includes('oswald'), `เตือนฟอนต์หลักที่ไม่มีไฟล์ (${lacking.warning})`)
  const none = wixFontPrelude({ p: { fontFamily: 'Arial, sans-serif' } })!
  assert(none.style === '' && none.warning === undefined, 'ฟอนต์ระบบ = ไม่แนบ ไม่เตือน')

  // ค่าธีมผิดรูป (ไม่ได้ผ่านตัวกรอง) ต้องไม่ทำให้ push ล้ม
  let threw = false
  try {
    wixFontPrelude({ p: { fontFamily: 123 }, fontFaces: [null, 'x'] } as unknown as UploadArticleStyle)
  } catch {
    threw = true
  }
  assert(!threw, 'ธีมผิดรูป = ไม่ throw')

  // ── attribute หน้าตาคล้าย (data-type / data-style) ต้องไม่ถูกอ่านแทนของจริง ─────────
  const lookalike = wixBlockStats(
    '<p>a</p><div type="paragraph" data-hook="rcv-block1"></div>' +
      '<div data-type="paragraph" type="empty-line" data-hook="rcv-block2"></div>' +
      '<p>b</p><div type="paragraph" data-hook="rcv-block3"></div>' +
      '<div data-type="paragraph" type="empty-line" data-hook="rcv-block4"></div>',
  )
  assert(lookalike.paragraph.spaced === 2 && lookalike.paragraph.tight === 0 && lookalike.emptyLines === 2, `data-type ไม่ถูกอ่านเป็น type (${JSON.stringify(lookalike)})`)
  const liLookalike = adaptWixArticleStyle({
    article: { ...MEASURED, li: { listStyle: 'none' } },
    html: '<ul><li data-style="list-style-type:square" style="list-style-type:disc;margin-inline-start:1.5em"><p>x</p></li></ul>',
  })
  assert(liLookalike.li?.listStyle === 'disc', `data-style ไม่ถูกอ่านเป็น style (${liLookalike.li?.listStyle})`)

  console.log(`wix-article: ผ่าน ${passed} ข้อ`)
}

main()
