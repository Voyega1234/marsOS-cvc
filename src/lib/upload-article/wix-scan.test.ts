// เทส scan หน้า Wix: อ่านสี/ฟอนต์จากตัวแปร --ricos-* และกล่องเนื้อหา post-description — หน้าที่ไม่ใช่ Wix ต้องได้ผลเดิม
// รัน: npx tsx src/lib/upload-article/wix-scan.test.ts
import assert from 'node:assert/strict'
import { __t, isWixPage } from './site-scan'

const body =
  '<div class="LDsTm" style="--ricos-custom-h2-color:rgb(255,255,255);--ricos-custom-h2-font-family:oswald,sans-serif;--ricos-custom-p-color:rgb(255,255,255);--ricos-custom-p-font-family:futura,sans-serif;--ricos-custom-link-color:rgb(65,185,213)">' +
  '<h2 class="h">Heading</h2><p class="p">Body paragraph text one.</p><p class="p">Body two <a href="/x">link</a>.</p><p class="p">Body three.</p></div>'
const css = 'body{background:#000;color:#fff;font-family:Arial} p.u{color:#999} h2.h{color:var(--ricos-custom-h2-color,#212121);font-family:var(--ricos-custom-h2-font-family,Arial)} p.p{color:var(--ricos-custom-p-color,#fff);font-family:var(--ricos-custom-p-font-family,Arial)}'
const wixHtml = `<html><head><meta name="generator" content="Wix.com Website Builder"/></head><body><article data-hook="post"><header><h1>Title</h1><p class="u">Updated: Oct 29</p></header><section data-hook="post-description">${body}</section></article></body></html>`
const plainHtml = wixHtml.replace(/<meta[^>]*>/, '').replace('data-hook="post-description"', 'class="x"')

assert.equal(isWixPage(wixHtml), true)
assert.equal(isWixPage(plainHtml), false)
assert.equal(isWixPage('<html><body><article><p>x</p></article></body></html>'), false)

const rules = __t.parseRules(css)
const w = __t.computeArticleStyle(wixHtml, rules, false)!
assert.equal(w.heading, '#ffffff')
assert.match(w.headingFont || '', /oswald/)
assert.match(w.bodyFont || '', /futura/)
assert.equal(w.link, '#41b9d5')
assert.ok(/post-description|section/.test(w.sampled[0]) || w.sampled[0].startsWith('section'))
assert.ok(w.sampled[1].includes('.p'), 'body paragraph sampled, not the Updated line')

const n = __t.computeArticleStyle(plainHtml, rules, false)!
assert.equal(n.link, '#0000ee')
assert.equal(n.heading, '#212121')
assert.match(n.bodyFont || '', /Arial/)
console.log('wix-scan.test.ts ok')
