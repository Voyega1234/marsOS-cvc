// เทสการเว้นวรรคอังกฤษ/ตัวเลขกับตัวไทย: npx tsx src/lib/latin-thai-spacing.test.ts
import { countLatinThaiBoundaries, spaceLatinThai } from './article-structure'
import { scanArticleStructure } from './upload-article/article-style-scan'
import { buildUploadArticleHtml } from './upload-article/build-html'
import type { UploadTheme } from './upload-article/types'

let passed = 0
function eq(actual: string, expected: string, msg: string) {
  if (actual !== expected) throw new Error(`FAIL: ${msg}\n  actual:   ${actual}\n  expected: ${expected}`)
  passed++
}

function main() {
  // ในข้อความเดียวกัน
  eq(spaceLatinThai('<p>NKพบว่า</p>'), '<p>NK พบว่า</p>', 'อังกฤษติดไทย')
  eq(spaceLatinThai('<p>ระหว่างNK</p>'), '<p>ระหว่าง NK</p>', 'ไทยติดอังกฤษ')
  eq(spaceLatinThai('<p>เก็บ60ปี</p>'), '<p>เก็บ 60 ปี</p>', 'ตัวเลขทั้งสองฝั่ง')
  eq(spaceLatinThai('<p>แพทย์ที่VAANAAดูแล</p>'), '<p>แพทย์ที่ VAANAA ดูแล</p>', 'สองจุดในประโยคเดียว')
  eq(spaceLatinThai('<p>NK พบว่า ระหว่าง NK</p>'), '<p>NK พบว่า ระหว่าง NK</p>', 'มีช่องว่างอยู่แล้วไม่เพิ่มซ้ำ')
  eq(spaceLatinThai('<p>ไม่แน่นอน</p>'), '<p>ไม่แน่นอน</p>', 'สระและวรรณยุกต์ไม่ถูกแยก')
  eq(spaceLatinThai('<p>NK-Cell</p>'), '<p>NK-Cell</p>', 'อังกฤษล้วนไม่แตะ')
  eq(spaceLatinThai('<p>พ.ศ.2568</p>'), '<p>พ.ศ.2568</p>', 'มีจุดคั่นไม่ถือว่าติดกัน')
  eq(spaceLatinThai('<p>50%ของ</p>'), '<p>50%ของ</p>', 'สัญลักษณ์คั่นไม่แตะ')

  // ข้ามแท็ก inline: ช่องว่างอยู่นอกแท็กเสมอ
  eq(spaceLatinThai('<p><strong>NK</strong>พบว่า</p>'), '<p><strong>NK</strong> พบว่า</p>', 'ปิดแท็กแล้วต่อไทย')
  eq(spaceLatinThai('<p>พบว่า<strong>NK</strong></p>'), '<p>พบว่า <strong>NK</strong></p>', 'ไทยแล้วเปิดแท็ก')
  eq(spaceLatinThai('<p>พบ<a href="https://a.com/x">NK</a>ใน</p>'), '<p>พบ <a href="https://a.com/x">NK</a> ใน</p>', 'ลิงก์สองฝั่ง')
  eq(spaceLatinThai('<p><em>NK</em><strong>พบ</strong></p>'), '<p><em>NK</em> <strong>พบ</strong></p>', 'ปิดแล้วเปิดแท็กติดกัน')
  eq(spaceLatinThai('<p><strong><em>NK</em></strong>พบ</p>'), '<p><strong><em>NK</em></strong> พบ</p>', 'ปิดซ้อนสองชั้น')
  eq(spaceLatinThai('<p>พบ<strong><em>NK</em></strong></p>'), '<p>พบ <strong><em>NK</em></strong></p>', 'เปิดซ้อนสองชั้น')

  // ข้ามบล็อกไม่ถือว่าติดกัน
  eq(spaceLatinThai('<p>NK</p><p>พบว่า</p>'), '<p>NK</p><p>พบว่า</p>', 'คนละย่อหน้า')
  eq(spaceLatinThai('<li>NK</li><li>พบ</li>'), '<li>NK</li><li>พบ</li>', 'คนละรายการ')
  eq(spaceLatinThai('<p>NK<br>พบ</p>'), '<p>NK<br>พบ</p>', 'ขึ้นบรรทัดใหม่')
  eq(spaceLatinThai('<p>NK<img src="a.png">พบ</p>'), '<p>NK<img src="a.png">พบ</p>', 'รูปคั่น')

  // ไม่แตะแท็ก แอตทริบิวต์ คอมเมนต์ และโค้ด
  const attr = '<a href="https://a.com/NKพบ" title="NKพบ>NKพบ" data-x=\'พบNK\'>x</a>'
  eq(spaceLatinThai(attr), attr, 'แอตทริบิวต์คงเดิม รวมค่าที่มี >')
  const comment = '<!-- CONVERT_CAKE_SEO_META\nTitle: NKพบว่า\n-->'
  eq(spaceLatinThai(comment), comment, 'คอมเมนต์ SEO คงเดิม')
  for (const tag of ['code', 'pre', 'style', 'script', 'kbd', 'samp', 'textarea']) {
    const html = `<${tag}>NKพบ</${tag}>`
    eq(spaceLatinThai(html), html, `เนื้อใน ${tag} คงเดิม`)
  }
  eq(spaceLatinThai('<p>NK<code>พบ</code>พบ</p>'), '<p>NK<code>พบ</code>พบ</p>', 'โค้ดคั่นไม่เติมช่องว่าง')
  eq(spaceLatinThai('<p>a < b พบNK</p>'), '<p>a < b พบ NK</p>', 'เครื่องหมายน้อยกว่าไม่ใช่แท็ก')
  eq(spaceLatinThai('<p>A&amp;Bพบ</p>'), '<p>A&amp;B พบ</p>', 'entity ไม่พัง')
  eq(spaceLatinThai(''), '', 'ว่างเปล่า')

  // เรียกซ้ำผลเท่าเดิม
  const once = spaceLatinThai('<p>พบ<strong>NK</strong>ใน60ปี</p>')
  eq(spaceLatinThai(once), once, 'ทำซ้ำได้ผลเดิม')

  // เงื่อนไขการเปิดใช้: ลูกค้าเดิมและต้นฉบับจากคนต้องเท่าเดิม
  const site = { name: 'x', url: 'https://x.test', language: 'th' as const }
  const baseTheme = { theme: '#111111', text: '#222222', border: '#333333', accent: '#444444', background: '#ffffff' } as unknown as UploadTheme
  const scanned = { ...baseTheme, detail: { structure: { posts: 3, toc: false, takeaways: false, references: false, conclusionBeforeFaq: true, faqPlain: true, latinThaiSpacing: true } } } as unknown as UploadTheme
  const scannedTight = { ...baseTheme, detail: { structure: { posts: 3, toc: false, takeaways: false, references: false } } } as unknown as UploadTheme
  const source = '<h2>หัวข้อ</h2><p>เซลล์NKพบว่าดี</p>'
  const run = (theme: UploadTheme, aiSource: boolean) => buildUploadArticleHtml({ sourceHtml: source, mode: 'html', theme, site, meta: { title: 't' }, aiSource }).html
  const hit = (html: string) => html.includes('เซลล์ NK พบว่าดี')
  if (!hit(run(scanned, true))) throw new Error('FAIL: บทความ AI + โครงจากสแกน ต้องเว้นวรรค')
  passed++
  if (hit(run(baseTheme, true))) throw new Error('FAIL: ลูกค้าเดิมไม่มีโครงจากสแกน ต้องเท่าเดิม')
  passed++
  if (hit(run(scanned, false))) throw new Error('FAIL: ต้นฉบับจากคนต้องเท่าเดิม')
  passed++
  if (hit(run(scannedTight, true))) throw new Error('FAIL: เว็บที่สแกนแล้วไม่ได้เว้นวรรค ต้องเท่าเดิม')
  passed++

  // วัดจากบทความของแต่ละเว็บ
  const num = (a: number, b: number, msg: string) => { if (a !== b) throw new Error(`FAIL: ${msg}: ${a} != ${b}`); passed++ }
  const c1 = countLatinThaiBoundaries('<p>NK พบว่า ระหว่างNK</p>')
  num(c1.spaced, 1, 'เว้นวรรค 1 จุด')
  num(c1.tight, 1, 'ติดกัน 1 จุด')
  const c2 = countLatinThaiBoundaries('<p><strong>NK</strong> พบ&nbsp;NK</p><p>NK</p><p>พบ</p><pre>NKพบ NK พบ</pre>')
  num(c2.spaced, 2, 'ข้ามแท็ก inline และ nbsp')
  num(c2.tight, 0, 'ไม่ข้ามบล็อก ไม่นับ pre')
  const c3 = countLatinThaiBoundaries('<p><strong>NK</strong>พบ</p>')
  num(c3.tight, 1, 'ติดกันข้ามแท็ก inline')

  const spacedPost = '<p>' + Array.from({ length: 12 }, () => 'เซลล์ NK พบว่า').join(' ') + '</p>'
  const tightPost = '<p>' + Array.from({ length: 12 }, () => 'เซลล์NKพบว่า').join(' ') + '</p>'
  const mixedPost = '<p>' + Array.from({ length: 6 }, () => 'เซลล์ NK พบว่า เซลล์NKพบว่า').join(' ') + '</p>'
  const flagOf = (bodies: string[]) => scanArticleStructure(bodies, false)?.structure.latinThaiSpacing
  if (flagOf([spacedPost]) !== true) throw new Error('FAIL: เว็บที่เว้นวรรคสม่ำเสมอต้องได้ค่า true')
  passed++
  if (flagOf([tightPost]) !== undefined) throw new Error('FAIL: เว็บที่เขียนติดกันต้องไม่ได้ค่า')
  passed++
  if (flagOf([mixedPost]) !== undefined) throw new Error('FAIL: เว็บที่ปนกันต้องไม่ได้ค่า')
  passed++
  if (flagOf(['<p>เซลล์ NK พบว่า</p>']) !== undefined) throw new Error('FAIL: ตัวอย่างน้อยเกินไปต้องไม่ได้ค่า')
  passed++
  if (flagOf(['<p>ไม่มีอังกฤษเลยสักคำในบทความนี้</p>']) !== undefined) throw new Error('FAIL: ไม่มีอังกฤษต้องไม่ได้ค่า')
  passed++

  console.log(`latin-thai-spacing: ${passed} passed`)
}

main()
