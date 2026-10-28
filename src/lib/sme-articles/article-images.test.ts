/**
 * รูปที่ Mars สร้างในบทความ SME + cover alt
 * Run: npx tsx src/lib/sme-articles/article-images.test.ts
 */
import { countSmeGeneratedFigures, removeSmeGeneratedFigures, setCoverAltInHtml, getCoverAltFromHtml } from './article-images'

let passed = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`)
  passed++
  console.log(`  ✓ ${msg}`)
}

const legacy = '<figure class="content-figure">\n  <img src="data:image/webp;base64,AAA" alt="x" />\n</figure>'
const gen = '<figure class="content-figure" data-ua-gen="1"><img src="https://x.com/a.webp" alt="y"></figure>'
const cover = '<figure class="content-figure content-cover"><img src="data:image/webp;base64,BBB" alt="c"></figure>'
const remote = '<figure class="content-figure"><img src="https://x.com/b.jpg" alt="z"></figure>'
const html = `<h1>T</h1>${cover}<h2>A</h2><p>a</p>${legacy}<h2>B</h2>${gen}<p>b</p>${remote}`

assert(countSmeGeneratedFigures(html) === 2, 'counts legacy + data-ua-gen')
const out = removeSmeGeneratedFigures(html)
assert(countSmeGeneratedFigures(out) === 0, 'removed all Mars figures')
assert(out.includes('content-cover'), 'cover figure untouched')
assert(out.includes('https://x.com/b.jpg'), 'https figure untouched')
assert(!out.includes('AAA') && !out.includes('a.webp'), 'legacy + gen gone')
assert(countSmeGeneratedFigures(cover) === 0, 'cover alone = 0')

// alt
assert(getCoverAltFromHtml('<p>x</p>') === '', 'no block = empty alt')
const withBlock = '<p>x</p>\n<!-- CONVERT_CAKE_SEO_META\nmeta_title: T\ncover_image_alt: old\nen_slug: s\n-->'
assert(getCoverAltFromHtml(withBlock) === 'old', 'reads alt')
const rep = setCoverAltInHtml(withBlock, 'new alt')
assert(getCoverAltFromHtml(rep) === 'new alt' && rep.includes('meta_title: T') && rep.includes('en_slug: s'), 'replace keeps other lines')
assert((rep.match(/cover_image_alt/g) || []).length === 1, 'replace does not duplicate')
const ins = setCoverAltInHtml('<p>x</p>\n<!-- CONVERT_CAKE_SEO_META\nmeta_title: T\n-->', 'added')
assert(getCoverAltFromHtml(ins) === 'added' && ins.includes('meta_title: T') && ins.trimEnd().endsWith('-->'), 'insert inside block')
const app = setCoverAltInHtml('<p>x</p>', 'tail')
assert(app.includes('<!-- CONVERT_CAKE_SEO_META') && getCoverAltFromHtml(app) === 'tail', 'append block when missing')
const dirty = setCoverAltInHtml(withBlock, 'a\nb --> c ' + 'z'.repeat(300))
assert(getCoverAltFromHtml(dirty).length <= 200 && !getCoverAltFromHtml(dirty).includes('-->'), 'sanitise newline/-->/length')
assert((dirty.match(/-->/g) || []).length === 1, 'block still closed once')

console.log(`\n${passed} passed`)
