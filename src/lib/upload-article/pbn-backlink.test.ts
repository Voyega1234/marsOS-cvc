/**
 * PBN Backlinks: keyword + URL ปลายทาง — บทความมีลิงก์เดียวไป URL นั้น ไม่มี internal link (เจ้าของสั่ง 2026-11-12)
 * Run: npx tsx src/lib/upload-article/pbn-backlink.test.ts
 */
import assert from 'node:assert/strict'
import { enforcePbnBacklink, normalizeTargetUrl, pbnBacklinkFor } from './pbn-backlink'
import { parseKeywordTable, parseKeywordText } from './keyword-import'
import { PBN_BACKLINKS_MAX, cleanPbnBacklinkCount, readPbnArticleTargets } from './pbn-sets'
import { buildWriterUserPrompt } from './writer'

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

// ── จำนวน Backlink ต่อบทความ (เลือกตอนสั่งเขียน) ──
const targetLinks = (html: string) => (html.match(new RegExp(`<a href="${URL_.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g')) || []).length

t('count: default result carries count 1', () => {
  const r = enforcePbnBacklink(`<p><a href="${URL_}">รับทำ google ads</a></p><p>อีกที <a href="${URL_}">รับทำ google ads</a></p>`, backlink)
  assert.equal(r.count, 1)
  assert.equal(r.removed, 1)
  assert.equal(targetLinks(r.html), 1)
})

t('count: keeps the first N target links, unwraps the rest', () => {
  const html = [1, 2, 3, 4].map((i) => `<p>ย่อหน้า ${i} <a href="${URL_}">รับทำ google ads</a></p>`).join('')
    + '<p><a href="https://other.example.org/">เว็บอื่น</a></p>'
  const r = enforcePbnBacklink(html, backlink, 3)
  assert.equal(r.count, 3)
  assert.equal(r.inserted, false)
  assert.equal(r.removed, 2) // ลิงก์ที่ 4 + เว็บอื่น
  assert.equal(targetLinks(r.html), 3)
  assert.equal(countLinks(r.html), 3)
  assert.ok(r.html.includes('ย่อหน้า 4 รับทำ google ads'))
})

t('count: tops up missing links from keyword text, one per paragraph', () => {
  const html = `<h2>รับทำ google ads คืออะไร</h2><p>เปิด <a href="${URL_}">รับทำ google ads</a> และ รับทำ google ads อีกครั้ง</p>`
    + '<p>ย่อหน้าสอง รับทำ google ads ซ้ำ รับทำ google ads</p><ul><li>ข้อ รับทำ google ads</li></ul><p>ไม่มีคำ</p>'
  const r = enforcePbnBacklink(html, backlink, 3)
  assert.equal(r.count, 3)
  assert.equal(r.inserted, true)
  assert.equal(targetLinks(r.html), 3)
  assert.ok(r.html.includes('<h2>รับทำ google ads คืออะไร</h2>')) // หัวข้อไม่ถูกใส่ลิงก์
  assert.ok(r.html.includes('และ รับทำ google ads อีกครั้ง')) // ย่อหน้าที่มีลิงก์แล้วไม่ใส่เพิ่ม
  assert.ok(r.html.includes('ซ้ำ รับทำ google ads</p>')) // ย่อหน้าละ 1 ลิงก์
})

t('count: not enough keyword text = reports the real count', () => {
  const r = enforcePbnBacklink('<p>เรา รับทำ google ads</p><p>ไม่มีคำ</p>', backlink, 4)
  assert.equal(r.count, 1)
  assert.equal(r.present, true)
  assert.equal(targetLinks(r.html), 1)
  const none = enforcePbnBacklink('<p>ไม่มีคำ</p>', backlink, 4)
  assert.equal(none.count, 0)
  assert.equal(none.present, false)
})

t('count: keyword split by a removed link is found again', () => {
  const r = enforcePbnBacklink('<p>ก่อน</p><p>บริการ รับทำ <a href="https://x.example.com/">google ads</a> ดี</p>', backlink, 2)
  assert.equal(r.count, 1)
  assert.ok(r.html.includes(`<a href="${URL_}" data-ua-link="1">รับทำ google ads</a>`))
})

t('count: out-of-range values are clamped', () => {
  assert.equal(cleanPbnBacklinkCount(undefined), 1)
  assert.equal(cleanPbnBacklinkCount('abc'), 1)
  assert.equal(cleanPbnBacklinkCount(0), 1)
  assert.equal(cleanPbnBacklinkCount(-3), 1)
  assert.equal(cleanPbnBacklinkCount(2.9), 2)
  assert.equal(cleanPbnBacklinkCount('3'), 3)
  assert.equal(cleanPbnBacklinkCount(99), PBN_BACKLINKS_MAX)
  const html = Array.from({ length: 8 }, (_, i) => `<p>${i} <a href="${URL_}">รับทำ google ads</a></p>`).join('')
  assert.equal(enforcePbnBacklink(html, backlink, 99).count, PBN_BACKLINKS_MAX)
  assert.equal(enforcePbnBacklink(html, backlink, 0).count, 1)
})

t('count: stored with the article target only when above 1', () => {
  const targets = readPbnArticleTargets({ pbnArticleTargets: {
    a: { siteId: 's1', profileId: 'main' },
    b: { siteId: 's1', profileId: 'main', backlinks: 3, cluster: 'investing-basics' },
    c: { siteId: 's1', profileId: 'main', backlinks: 1 },
    d: { siteId: 's1', profileId: 'main', backlinks: 'x' },
    e: { siteId: 's1', profileId: 'main', backlinks: 50 },
  } })
  assert.deepEqual(targets.a, { siteId: 's1', profileId: 'main' })
  assert.deepEqual(targets.b, { siteId: 's1', profileId: 'main', cluster: 'investing-basics', backlinks: 3 })
  assert.deepEqual(targets.c, { siteId: 's1', profileId: 'main' })
  assert.deepEqual(targets.d, { siteId: 's1', profileId: 'main' })
  assert.equal(targets.e.backlinks, PBN_BACKLINKS_MAX)
})

t('count: writer prompt is unchanged for 1 link and asks for N otherwise', () => {
  const task = { keyword: { id: 'k', keyword: 'รับทำ google ads' }, links: [], backlink } as unknown as Parameters<typeof buildWriterUserPrompt>[0]
  const one = buildWriterUserPrompt(task)
  assert.equal(buildWriterUserPrompt({ ...task, backlinkCount: 1 }), one)
  assert.ok(one.includes('ในเนื้อหา 1 ครั้งพอดี'))
  const three = buildWriterUserPrompt({ ...task, backlinkCount: 3 })
  assert.ok(three.includes('รวม 3 ลิงก์พอดี'))
  assert.ok(!three.includes('1 ครั้งพอดี'))
  assert.ok(three.includes('ห้ามมีลิงก์อื่นใดในบทความ'))
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
