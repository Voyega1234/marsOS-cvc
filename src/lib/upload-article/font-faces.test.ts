/**
 * เทสฟอนต์จริงจากการสแกน: CSS ที่ออกต้องปลอดภัย, ไม่มีฟอนต์ = ไม่มี CSS เพิ่ม
 * รัน: npx tsx src/lib/upload-article/font-faces.test.ts
 */
import { FONT_FILE_RE, fontFaceCss, fontMimeFromBytes, inlineFontFaceCss, proxiedFontUrl, usedFontFaces } from '@/lib/upload-article/font-faces'
import { buildStandaloneArticleHtml } from '@/lib/article-export'
import type { UploadFontFace } from '@/lib/upload-article/types'

let passed = 0
function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error('FAIL: ' + msg)
  passed++
}

const WOFF2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2, 3, 4])
const JOST: UploadFontFace = { family: 'Jost', weight: '400', style: 'normal', url: 'https://x.test/a/jost.woff2', format: 'woff2' }
const THAI: UploadFontFace = { family: 'sukhumvit-light', url: 'https://x.test/a/s.woff2', unicodeRange: 'U+0E00-0E7F' }
const SAME_FILE: UploadFontFace = { family: 'Full Sans SC', url: 'https://x.test/a/jost.woff2' }

async function main() {
  assert(fontFaceCss(undefined) === '', 'ไม่มีฟอนต์ = ไม่มี CSS')
  assert(fontFaceCss([]) === '', 'รายการว่าง = ไม่มี CSS')

  const css = fontFaceCss([JOST, THAI])
  assert(css.includes('font-family:"Jost"'), 'family')
  assert(css.includes(`src:url("${proxiedFontUrl(JOST.url)}") format("woff2")`), 'ผ่าน proxy + format')
  assert(css.includes('font-weight:400') && css.includes('font-style:normal'), 'weight/style')
  assert(css.includes('unicode-range:U+0E00-0E7F'), 'unicode range')
  assert(css.includes('font-display:swap'), 'ฟอนต์ยังไม่มาก็เห็นตัวหนังสือ')
  assert(decodeURIComponent(proxiedFontUrl('https://x.test/a b.woff2')).endsWith('a b.woff2'), 'เข้ารหัส URL')

  // ค่าปลอมจาก DB ต้องไม่หลุดเข้า CSS
  const evil: UploadFontFace[] = [
    { family: 'x"}body{display:none}', url: JOST.url },
    { family: 'Ok', url: 'http://x.test/a.woff2' },
    { family: 'Ok', url: 'https://x.test/a.woff2");}body{display:none}/*' },
    { family: 'Ok', url: 'javascript:alert(1)' },
  ]
  assert(fontFaceCss(evil) === '', 'family/url แปลกปลอมถูกตัดหมด')
  const badFields = fontFaceCss([{ family: 'Ok', url: JOST.url, weight: '400;x:y', style: 'bold;', format: 'w"', unicodeRange: 'U+0;}' }])
  assert(!/400;x|bold;|w"|U\+0;/.test(badFields), 'ฟิลด์เสริมแปลกปลอมถูกข้าม')
  assert(badFields.includes('font-family:"Ok"'), 'แถวยังใช้ได้ถ้า family/url ถูกต้อง')

  assert(FONT_FILE_RE.test('/a/b.woff2') && FONT_FILE_RE.test('/a.TTF'), 'นามสกุลฟอนต์')
  assert(!FONT_FILE_RE.test('/a.html') && !FONT_FILE_RE.test('/a.woff2/x'), 'นามสกุลอื่นไม่ผ่าน')

  assert(fontMimeFromBytes(WOFF2) === 'font/woff2', 'woff2')
  assert(fontMimeFromBytes(new Uint8Array([0x77, 0x4f, 0x46, 0x46])) === 'font/woff', 'woff')
  assert(fontMimeFromBytes(new Uint8Array([0x4f, 0x54, 0x54, 0x4f])) === 'font/otf', 'otf')
  assert(fontMimeFromBytes(new Uint8Array([0, 1, 0, 0])) === 'font/ttf', 'ttf')
  assert(fontMimeFromBytes(new TextEncoder().encode('<html>')) === null, 'html ไม่ใช่ฟอนต์')
  assert(fontMimeFromBytes(new Uint8Array([0x77])) === null, 'สั้นเกิน')

  const used = usedFontFaces([JOST, THAI, SAME_FILE, { family: 'Unused', url: 'https://x.test/u.woff2' }], ['"Full Sans SC", sukhumvit-light, sans-serif', 'jost', undefined])
  assert(used.length === 3 && !used.some((f) => f.family === 'Unused'), 'เลือกเฉพาะ family ที่ใช้จริง ไม่สนตัวพิมพ์')
  assert(usedFontFaces(undefined, ['Jost']).length === 0, 'ไม่มีรายการ = ว่าง')

  // ฝังในไฟล์ดาวน์โหลด: ไฟล์เดียวกันโหลดครั้งเดียว ทั้ง 2 family ได้ data URI
  let calls = 0
  const inlined = await inlineFontFaceCss([JOST, SAME_FILE], async () => {
    calls++
    return WOFF2
  })
  assert(calls === 1, 'URL ซ้ำโหลดครั้งเดียว')
  assert((inlined.css.match(/url\("data:font\/woff2;base64,/g) || []).length === 2, 'ทั้ง 2 family ได้ data URI')
  assert(!inlined.css.includes('x.test'), 'ไม่เหลือ URL เว็บลูกค้า')
  assert(inlined.css.includes('d09GMg') && inlined.skipped === 0, 'เนื้อไฟล์เป็น base64')

  const failed = await inlineFontFaceCss([JOST, THAI], async (u) => {
    if (u === THAI.url) throw new Error('network')
    return WOFF2
  })
  assert(failed.skipped === 1 && failed.css.includes('"Jost"') && !failed.css.includes('sukhumvit'), 'โหลดไม่ได้ข้ามตัวนั้น ไม่ล้มทั้งไฟล์')
  const notFont = await inlineFontFaceCss([JOST], async () => new TextEncoder().encode('<html>'))
  assert(notFont.css === '' && notFont.skipped === 1, 'ไม่ใช่ฟอนต์ไม่ถูกฝัง')
  const overBudget = await inlineFontFaceCss([JOST, THAI], async () => WOFF2, 'data:font/woff2;base64,'.length + Math.ceil(WOFF2.length / 3) * 4 + 5) // งบนับความยาว base64
  assert(overBudget.skipped === 1 && overBudget.css.includes('"Jost"'), 'เกินงบข้ามตัวที่เหลือ')
  const big = new Uint8Array(200_000)
  big.set(WOFF2)
  const bigCss = await inlineFontFaceCss([JOST], async () => big)
  assert(bigCss.css.length > 260_000, 'ไฟล์ใหญ่แปลง base64 ได้ไม่ล้น stack')

  // ไฟล์ดาวน์โหลด: ไม่ส่ง fontCss = เหมือนเดิม
  const base = { html: '<p>x</p>', title: 't', lang: 'th' as const }
  const plain = buildStandaloneArticleHtml(base)
  assert(plain === buildStandaloneArticleHtml({ ...base, fontCss: '' }), 'fontCss ว่าง = ไฟล์เท่าเดิม')
  assert(!plain.includes('@font-face'), 'ไม่มี @font-face')
  assert(buildStandaloneArticleHtml({ ...base, fontCss: css }).includes('@font-face{font-family:"Jost"'), 'ใส่ฟอนต์เมื่อส่งมา')

  console.log(`font-faces: ${passed} passed`)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
