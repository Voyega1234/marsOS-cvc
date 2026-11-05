// npx tsx src/lib/upload-article/content-region.test.ts
import { extractPostBodyHtml, looksLikeArticle, rankArticleLinks } from './site-scan'
import { fontFamiliesIn, primaryFontFamilies } from './font-faces'

let passed = 0
function assert(cond: unknown, name: string) {
  if (!cond) throw new Error(`FAILED: ${name}`)
  passed++
}
const BODY = '<p>หนึ่ง</p><p>สอง</p><p>สาม</p><p>สี่</p>'
const wrap = (inner: string) => `<!doctype html><html><head><style>p{color:red}</style></head><body><nav><p>เมนู</p><p>เมนู</p><p>เมนู</p><p>เมนู</p><p>เมนู</p></nav>${inner}<footer><p>ท้าย</p><p>ท้าย</p><p>ท้าย</p><p>ท้าย</p><p>ท้าย</p></footer></body></html>`
const body = (html: string) => extractPostBodyHtml(html) || ''

// class เดิมยังชนะเสมอ ไม่กระทบเว็บที่ใช้งานอยู่
const legacy = body(wrap(`<div class="post-body">${BODY}</div><div class="entry-content single">สั้น</div>`))
assert(legacy.startsWith('<div class="entry-content single">'), 'legacy class wins over builder class')
assert(!legacy.includes('หนึ่ง'), 'legacy class used even when short')

// builder ที่ไม่มี class มาตรฐาน
assert(body(wrap(`<div class="brxe-post-content x">${BODY}</div>`)).includes('สี่'), 'Bricks content found')
assert(body(wrap(`<div class="w-richtext">${BODY}</div>`)).includes('สี่'), 'Webflow content found')
assert(body(wrap(`<div class="prose lg:prose-xl">${BODY}</div>`)).includes('สี่'), 'Tailwind prose found')

// กล่องชื่อกว้างที่สั้น ไม่ใช่เนื้อบทความ — ข้ามไปกล่องถัดไป
const rte = body(wrap(`<div class="rte"><p>ส่งฟรี</p></div><main><div class="rte">${BODY}</div></main>`))
assert(rte.includes('สี่') && !rte.includes('ส่งฟรี'), 'short rte block skipped')

// มี <article> ยังใช้กล่องนั้นเหมือนเดิม
assert(body(wrap(`<article class="x">${BODY}</article>`)).startsWith('<article class="x">'), 'article fallback unchanged')

// ไม่รู้จัก class เลย: หากล่องที่มีย่อหน้ามากสุด ไม่หยิบเมนูหรือท้ายเว็บ
const unknown = body(wrap(`<div class="sidebar"><p>a</p><p>b</p><p>c</p></div><section class="x1 y2"><h2>หัวข้อ</h2>${BODY}<p>ห้า</p></section>`))
assert(unknown.startsWith('<section class="x1 y2">'), 'densest container wins')
assert(unknown.includes('ห้า') && !unknown.includes('เมนู') && !unknown.includes('ท้าย'), 'nav and footer are not content')

// <p> ไม่ปิด และ script ที่มี <p> ไม่ทำให้นับผิด
const unclosed = body(wrap(`<script>var t="<p></p><p></p><p></p><p></p><p></p><p></p>"</script><div class="z"><p>ก<p>ข<p>ค<p>ง</div>`))
assert(unclosed.startsWith('<div class="z">'), 'unclosed p and script handled')

// เนื้อหาน้อยเกินไม่นับเป็นบทความ
assert(extractPostBodyHtml(wrap('<div class="a"><p>หนึ่ง</p><p>สอง</p></div>')) === null, 'too few paragraphs gives null')
assert(extractPostBodyHtml('<html><body></body></html>') === null, 'empty page gives null')

// เลือกลิงก์บทความ: หน้าการตลาดในเมนูไม่ชนะบทความ
const home = `<nav><a href="https://x.co/ai-website-builder">a</a><a href="/pricing-and-plans">b</a></nav>
<a href="/blog/how-to-write-well">post</a><a href="https://x.co/blog/second-post-here">p2</a>
<a href="/2026/10/dated-post-title">p3</a><a href="/tag/long-tag-name-here">tag</a><a href="https://other.co/blog/external-post">ext</a><a href="/logo-large.png">img</a>`
const fromRoot = rankArticleLinks(home, 'https://x.co', 'x.co')
assert(fromRoot[0] === 'https://x.co/blog/how-to-write-well', 'blog link ranks first')
assert(fromRoot.slice(0, 3).includes('https://x.co/2026/10/dated-post-title'), 'dated link in top 3')
assert(!fromRoot.slice(0, 3).includes('https://x.co/ai-website-builder'), 'marketing page out of top 3')
assert(!fromRoot.some((u) => /other\.co|\/tag\/|\.png/.test(u)), 'external, tag and image links dropped')
assert(fromRoot.includes('https://x.co/ai-website-builder'), 'old candidates kept as last resort')
const under = rankArticleLinks('<a href="/news/other-section-post">n</a><a href="/journal/my-first-post">j</a>', 'https://x.co/journal', 'x.co')
assert(under[0] === 'https://x.co/journal/my-first-post', 'links under scanned path win')
const inside = rankArticleLinks('<a href="/some-other-page-here">o</a><article><a href="/my-long-article-slug">a</a></article>', 'https://x.co', 'x.co')
assert(inside[0] === 'https://x.co/my-long-article-slug', 'links inside article win over plain links')

// หน้าที่ใช้อ่านสไตล์ต้องเป็นบทความ
const para = 'ก'.repeat(150)
assert(looksLikeArticle(wrap(`<div class="entry-content"><p>${para}</p><p>${para}</p><p>${para}</p></div>`)), 'long content is an article')
assert(!looksLikeArticle(wrap('<div class="entry-content"><p>สั้น</p><p>สั้น</p><p>สั้น</p></div>')), 'short content is not an article')
assert(!looksLikeArticle(null), 'no page is not an article')

// ฟอนต์ระบบและตัวสำรองอัตโนมัติไม่ต้องหาไฟล์
assert(fontFamiliesIn(['"inter", "inter Fallback"']).join() === 'inter', 'next-font fallback skipped')
assert(fontFamiliesIn(['__Inter_Fallback_abc123']).length === 0, 'hashed fallback skipped')
assert(fontFamiliesIn(['"Iowan Old Style","Palatino Linotype",P052,serif']).length === 0, 'OS serif fonts skipped')
assert(fontFamiliesIn(['var(--font-x), Jost']).join() === 'Jost', 'unresolved var() skipped')
assert(fontFamiliesIn(['DB Heavent, sans-serif']).join() === 'DB Heavent', 'custom font kept')
assert(primaryFontFamilies(['Jost, sukhumvit-light, sans-serif', 'Arial, Full Sans SC']).join() === 'Jost,Full Sans SC', 'first loadable of each stack')

console.log(`content-region: ${passed} passed`)
