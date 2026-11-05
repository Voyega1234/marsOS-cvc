// npx tsx src/lib/upload-article/font-lookup.test.ts
import { findMissingFontFaces, googleFontUrl, keepReadingSubsets } from './font-lookup'
import { FONT_FACE_MAX, fontCoverage, fontFamiliesIn } from './font-faces'
import { absolutizeFontUrls } from './article-style-scan'
import type { UploadArticleStyle, UploadFontFace } from './types'

let passed = 0
function assert(cond: unknown, name: string) {
  if (!cond) throw new Error(`FAILED: ${name}`)
  passed++
}

const GOOGLE_CSS = `/* cyrillic */
@font-face { font-family: 'Prompt'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/s/prompt/cyr.woff2) format('woff2'); unicode-range: U+0400; }
/* thai */
@font-face { font-family: 'Prompt'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/s/prompt/thai.woff2) format('woff2'); unicode-range: U+0E01; }
/* latin */
@font-face { font-family: 'Prompt'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/s/prompt/latin.woff2) format('woff2'); unicode-range: U+0000; }`

const ownFace = (family: string): UploadFontFace => ({ family, weight: '400', url: `https://site.test/fonts/${family}.woff2`, format: 'woff2' })
const look = (stack: string, extra: Partial<UploadArticleStyle> = {}): UploadArticleStyle => ({ p: { fontFamily: stack, fontWeight: 400 }, ...extra })

function fetcher(map: Record<string, string | null> = {}) {
  const calls: string[] = []
  const fn = async (url: string) => {
    calls.push(url)
    return Object.prototype.hasOwnProperty.call(map, url) ? map[url] : null
  }
  return { calls, fn }
}

async function main() {
  // ฟอนต์ระบบไม่ต้องมีไฟล์ · ชื่อคงตัวพิมพ์เดิม · ไม่ซ้ำ
  const names = fontFamiliesIn(['Jost, "Full Sans SC", sans-serif', 'jost, Arial, -apple-system'])
  assert(names.join('|') === 'Jost|Full Sans SC', 'families skip system fonts and duplicates')
  assert(fontFamiliesIn([undefined, '']).length === 0, 'empty stacks give no families')

  // สถานะแต่ละฟอนต์
  const cov = fontCoverage(['Jost, Prompt, Nope, serif'], [
    ownFace('Jost'),
    { family: 'Prompt', url: 'https://fonts.gstatic.com/s/prompt/thai.woff2' },
    { family: 'Nope', url: 'https://use.typekit.net/af/abc/000' },
  ])
  assert(cov[0].status === 'site' && cov[0].files === 1, 'own file counts as site')
  assert(cov[1].status === 'google', 'gstatic file counts as google')
  assert(cov[2].status === 'missing', 'extension-less url cannot load through the proxy')

  // เว็บมีไฟล์ของตัวเองครบ: ไม่เรียกเน็ต ไม่เปลี่ยนค่า
  {
    const f = fetcher()
    const own = [ownFace('Jost')]
    const r = await findMissingFontFaces({ article: look('Jost, sans-serif', { fontFaces: own }), page: '<link href="https://fonts.googleapis.com/css2?family=Prompt">', rawCss: '', fetchCss: f.fn })
    assert(f.calls.length === 0, 'no fetch when nothing is missing')
    assert(r.faces === own && r.missing.length === 0, 'faces returned untouched')
  }
  // ใช้แต่ฟอนต์ระบบ: ไม่เรียกเน็ต
  {
    const f = fetcher()
    const r = await findMissingFontFaces({ article: look('Arial, sans-serif'), page: '', rawCss: '', fetchCss: f.fn })
    assert(f.calls.length === 0 && r.faces === undefined && r.missing.length === 0, 'system fonts need nothing')
  }
  // หน้าโหลด Google Fonts ด้วย <link> (&amp;): ใช้ลิงก์นั้นก่อน ไทยมาก่อน ตัดชุดอื่นทิ้ง
  {
    const url = 'https://fonts.googleapis.com/css2?family=Prompt:wght@400&display=swap'
    const f = fetcher({ [url]: GOOGLE_CSS })
    const page = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Prompt:wght@400&amp;display=swap">`
    const r = await findMissingFontFaces({ article: look('Prompt, sans-serif'), page, rawCss: '', fetchCss: f.fn })
    assert(f.calls.length === 1 && f.calls[0] === url, 'decoded link url fetched once')
    assert(r.faces?.length === 2, 'kept thai and latin only')
    assert(r.faces?.[0].url.endsWith('thai.woff2'), 'thai subset comes first')
    assert(!r.faces?.some((x) => x.url.includes('cyr')), 'cyrillic dropped')
    assert(r.missing.length === 0, 'nothing missing after link lookup')
  }
  // ไม่มีลิงก์บนหน้า: ค้นตามชื่อ น้ำหนักเรียงตามลำดับ
  {
    const url = googleFontUrl('Noto Sans Thai', [700, 400])
    assert(url === 'https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;700&display=swap', 'name lookup url sorted')
    const css = GOOGLE_CSS.replace(/Prompt/g, 'Noto Sans Thai')
    const f = fetcher({ [url]: css })
    const article = look('Noto Sans Thai', { h2: { fontFamily: 'Noto Sans Thai', fontWeight: 700 } })
    const r = await findMissingFontFaces({ article, page: '', rawCss: '', fetchCss: f.fn })
    assert(f.calls[0] === url, 'lookup by name')
    assert(r.faces?.length === 2 && r.missing.length === 0, 'lookup fills the font')
  }
  // ไม่มีน้ำหนักนั้น (400 คืน null): ลองใหม่แบบไม่ระบุน้ำหนัก
  {
    const noWeight = googleFontUrl('Prompt', [])
    const f = fetcher({ [noWeight]: GOOGLE_CSS })
    const r = await findMissingFontFaces({ article: look('Prompt'), page: '', rawCss: '', fetchCss: f.fn })
    assert(f.calls.length === 2 && f.calls[1] === noWeight, 'retry without weights')
    assert(r.missing.length === 0, 'retry fills the font')
  }
  // ชื่อมีขีด = ฟอนต์ของเว็บเอง ไม่ค้น · แจ้งว่าขาด
  {
    const f = fetcher()
    const r = await findMissingFontFaces({ article: look('sukhumvit-light, sans-serif'), page: '', rawCss: '', fetchCss: f.fn })
    assert(!f.calls.some((u) => u.includes('googleapis')), 'hyphenated custom name is not looked up in Google')
    assert(r.missing.join() === 'sukhumvit-light', 'reported as missing')
    assert(r.faces === undefined, 'no faces invented')
  }
  // @import ไฟล์อื่น: เอาแค่ @font-face + ทำ URL ให้เต็ม
  {
    const imp = 'https://site.test/css/fonts.css'
    const f = fetcher({ [imp]: `@font-face{font-family:"MyFont";font-weight:400;src:url(../f/my.woff2) format("woff2")} body{color:red}` })
    const raw = absolutizeFontUrls('@import "./fonts.css";', 'https://site.test/css/main.css')
    assert(raw.includes('@import url("https://site.test/css/fonts.css")'), 'relative import made absolute')
    const r = await findMissingFontFaces({ article: look('MyFont'), page: '', rawCss: raw, fetchCss: f.fn })
    assert(r.faces?.[0].url === 'https://site.test/f/my.woff2', 'font file from import, url resolved')
    assert(r.missing.length === 0, 'import filled the font')
    assert(!JSON.stringify(r.faces).includes('red'), 'other rules ignored')
  }
  // เน็ตพังต้องไม่ทำให้สแกนพัง
  {
    const r = await findMissingFontFaces({ article: look('Prompt'), page: '', rawCss: '', fetchCss: async () => { throw new Error('boom') } })
    assert(r.missing.join() === 'Prompt' && r.faces === undefined, 'fetch failure returns input')
  }
  // เพดานจำนวนไฟล์
  {
    const own = Array.from({ length: FONT_FACE_MAX }, (_, i) => ({ family: 'Jost', weight: String(i), url: `https://site.test/${i}.woff2` }))
    const url = googleFontUrl('Prompt', [400])
    const f = fetcher({ [url]: GOOGLE_CSS })
    const r = await findMissingFontFaces({ article: look('Jost, Prompt', { fontFaces: own }), page: '', rawCss: '', fetchCss: f.fn })
    assert(r.faces?.length === FONT_FACE_MAX, 'cap holds')
  }
  // Fontsource: Google ไม่มี → ค้นชื่อใน Fontsource
  const FS = (id: string) => `https://api.fontsource.org/v1/fonts/${id}`
  const meta = (o: Record<string, unknown>) => JSON.stringify({ id: 'jost', family: 'Jost', subsets: ['cyrillic', 'latin', 'latin-ext', 'thai'], weights: [100, 300, 400, 500, 700, 900], styles: ['normal'], unicodeRange: { latin: 'U+0000-00FF,U+0131', thai: 'U+0E01-0E5B' }, ...o })
  {
    const f = fetcher({ [FS('jost')]: meta({}) })
    const article = look('Jost, sans-serif', { h2: { fontFamily: 'Jost', fontWeight: 700 }, h3: { fontFamily: 'Jost', fontWeight: 650 } })
    const r = await findMissingFontFaces({ article, page: '', rawCss: '', fetchCss: f.fn })
    assert(f.calls[f.calls.length - 1] === FS('jost'), 'fontsource is the last step')
    assert(r.missing.length === 0, 'fontsource fills the font')
    const urls = (r.faces || []).map((x) => x.url)
    assert(urls.length === 4 && urls.every((u) => u.startsWith('https://cdn.jsdelivr.net/fontsource/fonts/jost@latest/') && u.endsWith('-normal.woff2')), 'jsdelivr urls, 2 subsets x 2 weights')
    assert(urls.every((u) => /\/(thai|latin)-/.test(u)), 'thai and latin only')
    assert((r.faces || []).every((x) => x.family === 'Jost'), 'family as the page asked')
    assert(!urls.some((u) => /-(650)-/.test(u)), 'only available weights')
    assert(r.faces?.some((x) => x.unicodeRange === 'U+0E01-0E5B'), 'safe unicode-range kept')
    assert(fontCoverage(['Jost'], r.faces)[0].status === 'site', 'faces loadable through the proxy')
  }
  // น้ำหนักที่ใช้ไม่มีเลย: ใช้ตัวใกล้สุด · ไม่มีน้ำหนักที่ใช้: 400
  {
    const f = fetcher({ [FS('jost')]: meta({ weights: [300, 600], subsets: ['latin'] }) })
    const r = await findMissingFontFaces({ article: look('Jost'), page: '', rawCss: '', fetchCss: f.fn })
    assert(r.faces?.length === 1 && r.faces[0].url.endsWith('latin-300-normal.woff2'), 'nearest weight used')
    const f2 = fetcher({ [FS('jost')]: meta({}) })
    const r2 = await findMissingFontFaces({ article: { p: { fontFamily: 'Jost' } }, page: '', rawCss: '', fetchCss: f2.fn })
    assert(r2.faces?.length === 2 && r2.faces.every((x) => x.url.includes('-400-')), 'default 400')
  }
  // family ไม่ตรง: ไม่เพิ่ม ยังขาด
  {
    const f = fetcher({ [FS('sukhumvit-light')]: meta({ id: 'sukhumvit', family: 'Sukhumvit' }) })
    const r = await findMissingFontFaces({ article: look('sukhumvit-light'), page: '', rawCss: '', fetchCss: f.fn })
    assert(f.calls.includes(FS('sukhumvit-light')), 'hyphen name tried in fontsource')
    assert(r.faces === undefined && r.missing.join() === 'sukhumvit-light', 'family mismatch rejected')
  }
  // เจอใน Google แล้ว: ไม่เรียก Fontsource · ไม่มีอะไรขาด: ไม่เรียกเลย
  {
    const f = fetcher({ [googleFontUrl('Prompt', [400])]: GOOGLE_CSS })
    await findMissingFontFaces({ article: look('Prompt'), page: '', rawCss: '', fetchCss: f.fn })
    assert(!f.calls.some((u) => u.includes('fontsource')), 'google hit skips fontsource')
    const f2 = fetcher()
    await findMissingFontFaces({ article: look('Jost', { fontFaces: [ownFace('Jost')] }), page: '', rawCss: '', fetchCss: f2.fn })
    assert(f2.calls.length === 0, 'nothing missing, no fontsource call')
  }
  // JSON พัง / 404 / หมดเวลา / เน็ตพัง: ไม่ throw ไม่มีไฟล์
  for (const body of ['{not json', null, '[]', '"x"', 'null', JSON.stringify({ family: 5 })]) {
    const f = fetcher({ [FS('jost')]: body })
    const r = await findMissingFontFaces({ article: look('Jost'), page: '', rawCss: '', fetchCss: f.fn })
    assert(r.faces === undefined && r.missing.join() === 'Jost', `bad metadata ${String(body).slice(0, 10)} ignored`)
  }
  {
    const r = await findMissingFontFaces({ article: look('Jost'), page: '', rawCss: '', fetchCss: async () => new Promise<string | null>(() => {}), deadlineMs: 30 })
    assert(r.faces === undefined && r.missing.join() === 'Jost', 'deadline returns without faces')
    const r2 = await findMissingFontFaces({ article: look('Jost'), page: '', rawCss: '', fetchCss: async () => null, deadlineMs: -1 })
    assert(r2.faces === undefined, 'expired deadline no faces')
  }
  // ฉีด CSS ผ่าน family / unicodeRange
  {
    const evil = "Jost'; } body{background:url(https://evil.test/x)} @font-face{font-family:'x"
    const f = fetcher({ [FS('jost')]: meta({ family: evil, unicodeRange: {} }) })
    const r = await findMissingFontFaces({ article: look('Jost'), page: '', rawCss: '', fetchCss: f.fn })
    assert(r.faces === undefined, 'evil family rejected')
    const f2 = fetcher({ [FS('jost')]: meta({ unicodeRange: { latin: 'U+0000; } body{x:y} @font-face{src:url(https://evil.test/a.woff2)', thai: 'U+0E01;}' } }) })
    const r2 = await findMissingFontFaces({ article: look('Jost'), page: '', rawCss: '', fetchCss: f2.fn })
    assert(r2.faces?.length === 2 && r2.faces.every((x) => !x.unicodeRange && x.url.startsWith('https://cdn.jsdelivr.net/')), 'unsafe unicode-range dropped')
    assert(!JSON.stringify(r2.faces).includes('evil'), 'no injected url')
    // ชื่อที่ไม่ผ่านตัวกรอง ไม่ถูกยิง
    const f3 = fetcher()
    await findMissingFontFaces({ article: look('"Jost/../x"'), page: '', rawCss: '', fetchCss: f3.fn })
    assert(!f3.calls.some((u) => u.includes('fontsource')), 'unsafe name never reaches a url')
  }
  // เพดานจำนวนไฟล์กับ Fontsource
  {
    const own = Array.from({ length: FONT_FACE_MAX - 1 }, (_, i) => ({ family: 'Other', weight: String(i), url: `https://site.test/${i}.woff2` }))
    const f = fetcher({ [FS('jost')]: meta({}) })
    const r = await findMissingFontFaces({ article: look('Other, Jost', { fontFaces: own }), page: '', rawCss: '', fetchCss: f.fn })
    assert(r.faces?.length === FONT_FACE_MAX, 'fontsource respects cap')
  }
  // ไฟล์ซ้ำไม่นับเพิ่ม
  assert(keepReadingSubsets('@font-face{font-family:A;src:url(https://x.test/a.woff2)}').includes('font-family:A'), 'no subset comments keeps all blocks')
  assert(!keepReadingSubsets(GOOGLE_CSS).includes('/*'), 'comments removed')

  console.log(`font-lookup: ${passed} passed`)
}
main().catch((e) => { console.error(e); process.exit(1) })
