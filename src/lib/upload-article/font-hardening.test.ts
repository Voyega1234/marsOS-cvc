// ทดสอบการเสริมความปลอดภัยของ pipeline ฟอนต์/สแกน · รัน: npx tsx src/lib/upload-article/font-hardening.test.ts
import assert from 'node:assert/strict'
import { keepReadingSubsets } from '@/lib/upload-article/font-lookup'
import { absolutizeFontUrls, parseFontFaces } from '@/lib/upload-article/article-style-scan'
import { sanitizeThemeDetail, mergeScannedDetail, sanitizeThemeDraft } from '@/lib/upload-article/theme-css'
import { assertCrawlable } from '@/lib/competitor-gap/urls'
import { readCapped } from '@/lib/upload-article/safe-fetch'
import { DEFAULT_UPLOAD_THEME } from '@/lib/upload-article/types'

async function main() {
  // 1) CSS ไม่ปิดปีกกา ~2MB ต้องจบเร็ว
  const hostile = '@font-face{'.repeat(180_000)
  const t0 = Date.now()
  keepReadingSubsets(hostile)
  absolutizeFontUrls(hostile, 'https://a.test/')
  parseFontFaces(hostile, ['x'], [])
  assert(Date.now() - t0 < 1500, `hostile css too slow ${Date.now() - t0}ms`)
  const ok = '/* thai */\n@font-face{font-family:"A";src:url(a.woff2)}'
  assert(keepReadingSubsets(ok).startsWith('@font-face'), 'ปกติยังใช้ได้')
  assert(absolutizeFontUrls(ok, 'https://a.test/x/').includes('https://a.test/x/a.woff2'))

  // 4) เครื่องหมายคำพูดคี่ + ช่องว่าง
  const q = (fontFamily: string) => sanitizeThemeDetail({ article: { p: { fontFamily } } })?.article?.p?.fontFamily
  assert.equal(q("'Kanit, sans-serif"), undefined)
  assert.equal(q('"Kanit'), undefined)
  assert.equal(q("'Kanit',   sans-serif"), "'Kanit', sans-serif")
  assert.equal(sanitizeThemeDraft({ ...DEFAULT_UPLOAD_THEME, fontFamily: "'Bad" }).fontFamily, undefined)

  // 6) safeFluid + family
  const f = (fontSize: string) => sanitizeThemeDetail({ article: { p: { fontSize } } })?.article?.p?.fontSize
  assert.equal(f('1/*x*/px'), undefined)
  assert.equal(f('calc(1px + 2px'), undefined)
  assert.equal(f('calc(1px) + 2)'), undefined)
  assert.equal(f('clamp(30px,2vw,42px)'), 'clamp(30px,2vw,42px)')
  const fam = (family: string) => sanitizeThemeDetail({ article: { fontFaces: [{ family, url: 'https://a.test/a.woff2' }] } })?.article?.fontFaces
  assert.equal(fam('Bad\nName'), undefined)
  assert(fam('Good Name'))

  // 13) ไฟล์ที่ทีมวางเองไม่หายตอนสแกนใหม่
  const team = { family: 'Mine', url: 'https://a.test/m.woff2', from: 'team' as const }
  assert.equal(sanitizeThemeDetail({ article: { fontFaces: [team] } })?.article?.fontFaces?.[0].from, 'team')
  const merged = mergeScannedDetail({ article: { fontFaces: [team] } }, { article: { fontFaces: [{ family: 'Site', url: 'https://a.test/s.woff2' }] } })
  assert.deepEqual(merged?.article?.fontFaces?.map((x) => x.family), ['Mine', 'Site'])

  // 9) ช่วงที่ถูกบล็อกเพิ่ม
  for (const h of ['[64:ff9b::808:808]', '[2002:808:808::1]', '[ff02::1]', '198.18.0.1', '198.19.255.1', '[::ffff:7f00:1]']) {
    assert.equal((await assertCrawlable(`http://${h}/`)).ok, false, h)
  }
  assert.equal((await assertCrawlable('http://127.0.0.1/')).ok, false)
  // 10) ตัวไฟล์ใหญ่เกินเพดานต้องถูกตัด ไม่อ่านค้าง
  const capped = await readCapped(new Response(new Uint8Array(5000)), 1000)
  assert.equal(capped.length, 1000)
  const small = await readCapped(new Response(new Uint8Array(10)), 1000)
  assert.equal(small.length, 10)
  let pulls = 0
  const endless = new ReadableStream<Uint8Array>({ pull(c) { pulls++; c.enqueue(new Uint8Array(4096)) } })
  assert.equal((await readCapped(new Response(endless), 10_000)).length, 10_000)
  assert.ok(pulls < 50, 'หยุดอ่านเมื่อถึงเพดาน')
  assert.equal((await readCapped(new Response(null), 1000)).length, 0)
  console.log('font-hardening tests passed')
}
main().catch((e) => { console.error(e); process.exit(1) })
