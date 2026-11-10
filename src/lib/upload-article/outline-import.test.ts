/**
 * Import Outline (server helper): buildOutlineKeyword
 * Run: npx tsx src/lib/upload-article/outline-import.test.ts
 */
import { buildOutlineKeyword, OUTLINE_EMPTY_ERROR } from './outline-import'
import { importFromText } from './import-source'

let passed = 0
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`)
  passed++
  console.log(`  ✓ ${msg}`)
}

const now = new Date('2026-11-10T00:00:00.000Z')

console.log('buildOutlineKeyword')
{
  const html = `<h1>วิธีเลือกคอนโดใกล้ BTS</h1>
<p>Keyword: คอนโดใกล้ BTS</p>
<h2>1. ทำไมต้องใกล้ BTS</h2>
<h2>2. ราคาเฉลี่ย</h2>
<h3>2.1 โซนสุขุมวิท</h3>`
  const kw = buildOutlineKeyword(html, { source: 'file', sourceName: 'outline-1.docx' }, now)
  assert(kw.keyword === 'คอนโดใกล้ BTS', 'keyword จากบรรทัด Keyword:')
  assert(kw.title === 'วิธีเลือกคอนโดใกล้ BTS', 'title จาก H1')
  assert(kw.outline?.items.length === 3, 'items 3 ข้อ')
  assert(kw.outline?.source === 'file' && kw.outline.sourceName === 'outline-1.docx', 'source/sourceName')
  assert(kw.outline?.importedAt === now.toISOString() && kw.createdAt === now.toISOString(), 'importedAt/createdAt')
  assert(kw.intent === '' && kw.articleType === '' && kw.volume === null, 'ช่องอื่นว่าง')
  assert(typeof kw.id === 'string' && kw.id.length > 0, 'มี id')
}

console.log('fallback + error')
{
  const kw = buildOutlineKeyword('<h2>หัวข้อ A</h2><h2>หัวข้อ B</h2>', { source: 'paste', sourceName: 'my-outline.docx', importerTitle: 'ชื่อจาก importer' }, now)
  assert(kw.title === 'ชื่อจาก importer', 'title fallback = ชื่อจาก importer')
  assert(kw.keyword === 'ชื่อจาก importer', 'keyword fallback = title')
  const kw2 = buildOutlineKeyword('<h2>หัวข้อ A</h2>', { source: 'file', sourceName: 'my outline.docx' }, now)
  assert(kw2.title === 'my outline' && kw2.keyword === 'my outline', 'ไม่มี title → ชื่อไฟล์ไม่มีนามสกุล')
  let msg = ''
  try { buildOutlineKeyword(importFromText('แค่ย่อหน้าเดียว ไม่มีหัวข้อ').html, { source: 'paste', sourceName: 'x' }, now) } catch (e) { msg = (e as Error).message }
  assert(msg === OUTLINE_EMPTY_ERROR, 'ไม่มีหัวข้อ → error')
}

console.log(`\n${passed} passed`)
