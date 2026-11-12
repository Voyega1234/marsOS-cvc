/**
 * PBN Backlinks: keyword + URL ปลายทาง — บทความมีลิงก์เดียวไป URL นั้น ไม่มี internal link (เจ้าของสั่ง 2026-11-12)
 * Run: npx tsx src/lib/upload-article/pbn-backlink.test.ts
 */
import assert from 'node:assert/strict'
import { enforcePbnBacklink, normalizeTargetUrl, pbnBacklinkFor } from './pbn-backlink'
import { parseKeywordTable, parseKeywordText } from './keyword-import'

let n = 0
function t(name: string, fn: () => void) {
  fn()
  n++
  console.log(`ok ${n} - ${name}`)
}

const URL_ = 'https://money.example.com/google-ads'
const backlink = { keyword: 'รับทำ google ads', url: URL_ }
const countLinks = (html: string) => (html.match(/<a\b/g) || []).length

t('normalizeTargetUrl', () => {
  assert.equal(normalizeTargetUrl(''), '')
  assert.equal(normalizeTargetUrl('   '), '')
  assert.equal(normalizeTargetUrl('example.com/page'), 'https://example.com/page')
  assert.equal(normalizeTargetUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1')
  assert.equal(normalizeTargetUrl('javascript:alert(1)'), null)
  assert.equal(normalizeTargetUrl('not a url'), null)
  assert.equal(normalizeTargetUrl('localhost'), null)
  assert.equal(normalizeTargetUrl(42), null)
})

t('pbnBacklinkFor requires URL', () => {
  assert.equal(pbnBacklinkFor({ keyword: 'x', targetUrl: '' }), null)
  assert.equal(pbnBacklinkFor({ keyword: 'x' }), null)
  assert.deepEqual(pbnBacklinkFor({ keyword: ' x ', targetUrl: 'example.com' }), { keyword: 'x', url: 'https://example.com/' })
})

t('keeps AI target link, strips every other link', () => {
  const html = `<p>อ่าน <a href="https://pbn.example.net/other">บทความอื่น</a> และ <a href="${URL_}/">รับทำ google ads</a></p>`
    + `<p>ซ้ำ <a href="${URL_}">รับทำ google ads</a> ดู <a href="/internal">ภายใน</a> <a href="#faq">FAQ</a></p>`
    + `<h2>แหล่งอ้างอิง</h2><ul><li><a href="https://pubmed.ncbi.nlm.nih.gov/1">งานวิจัย</a></li></ul>`
  const r = enforcePbnBacklink(html, backlink)
  assert.equal(r.present, true)
  assert.equal(r.inserted, false)
  assert.equal(r.removed, 4)
  assert.equal(countLinks(r.html), 2) // target + #faq anchor
  assert.ok(r.html.includes(`<a href="${URL_}">รับทำ google ads</a>`))
  assert.ok(r.html.includes('<a href="#faq">FAQ</a>'))
  assert.ok(r.html.includes('งานวิจัย') && r.html.includes('ภายใน') && r.html.includes('บทความอื่น'))
})

t('inserts backlink when AI forgot', () => {
  const html = '<p>เริ่มต้น</p><p>เราให้บริการ รับทำ google ads แบบมืออาชีพ</p>'
  const r = enforcePbnBacklink(html, backlink)
  assert.equal(r.present, true)
  assert.equal(r.inserted, true)
  assert.equal(countLinks(r.html), 1)
  assert.ok(r.html.includes(`href="${URL_}"`))
})

t('keyword missing in text = not present', () => {
  const r = enforcePbnBacklink('<p>ไม่มีคำนี้</p>', backlink)
  assert.equal(r.present, false)
  assert.equal(countLinks(r.html), 0)
})

t('system blocks untouched', () => {
  const html = `<p>รับทำ google ads</p><div class="content-cta"><a href="https://line.me/x">ติดต่อ</a></div>`
  const r = enforcePbnBacklink(html, backlink)
  assert.ok(r.html.includes('<a href="https://line.me/x">ติดต่อ</a>'))
  assert.ok(r.html.includes(`href="${URL_}"`))
  assert.equal(r.removed, 0)
})

t('import: header URL column', () => {
  const p = parseKeywordTable([['Keyword', 'Target URL', 'Volume'], ['seo', 'https://a.com/seo', '100']])
  assert.equal(p.rows[0].keyword, 'seo')
  assert.equal(p.rows[0].targetUrl, 'https://a.com/seo')
  assert.equal(p.rows[0].volume, 100)
  const th = parseKeywordTable([['คีย์เวิร์ด', 'ลิงก์ปลายทาง'], ['seo', 'https://a.com/seo']])
  assert.equal(th.rows[0].targetUrl, 'https://a.com/seo')
})

t('import: headerless paste', () => {
  const p = parseKeywordText('รับทำ google ads\thttps://a.com/ads\nseo, https://a.com/seo, 500\nfacebook ads https://a.com/fb\nแค่คำ')
  assert.equal(p.rows.length, 4)
  assert.deepEqual([p.rows[0].keyword, p.rows[0].targetUrl], ['รับทำ google ads', 'https://a.com/ads'])
  assert.deepEqual([p.rows[1].keyword, p.rows[1].targetUrl, p.rows[1].volume], ['seo', 'https://a.com/seo', 500])
  assert.deepEqual([p.rows[2].keyword, p.rows[2].targetUrl], ['facebook ads', 'https://a.com/fb'])
  assert.equal(p.rows[3].keyword, 'แค่คำ')
  assert.ok(!p.rows[3].targetUrl)
})

t('import: old volume-only paste unchanged', () => {
  const p = parseKeywordText('รับทำ facebook ads, 800\nSEO marketing')
  assert.deepEqual([p.rows[0].keyword, p.rows[0].volume, p.rows[0].targetUrl], ['รับทำ facebook ads', 800, undefined])
  assert.equal(p.rows[1].keyword, 'SEO marketing')
})

console.log(`\n${n} passed`)
