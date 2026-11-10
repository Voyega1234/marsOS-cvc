/**
 * Import Outline: อ่าน outline / ตัดส่วน outline ใน Master Prompt / ตรวจหัวข้อหลังเขียน (เจ้าของสั่ง 2026-11-10)
 * Run: npx tsx src/lib/upload-article/outline.test.ts
 */
import {
  checkOutline,
  insertOutlineSections,
  outlineHasFaq,
  outlineWarnings,
  outlineWriterBlock,
  parseOutlineFromHtml,
  splitOutlineFill,
  stripMasterOutlineSection,
} from './outline';
import { OUTLINE_HEADING } from './example-structure';
import { importFromText } from './import-source';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

console.log('parseOutlineFromHtml');
{
  const html = `<h1>วิธีเลือกคอนโดใกล้ BTS</h1>
<p>Keyword: คอนโดใกล้ BTS</p>
<p>บทนำเล่าปัญหาการเดินทาง</p>
<h2>1. ทำไมคอนโดใกล้ BTS ถึงน่าสนใจ</h2>
<ul><li>ประหยัดเวลา</li><li>ปล่อยเช่าง่าย</li></ul>
<h3>ข้อดีด้านการเดินทาง</h3>
<h2>คำถามที่พบบ่อย</h2>
<h3>คอนโดใกล้ BTS แพงกว่าไหม?</h3>`;
  const o = parseOutlineFromHtml(html);
  assert(o.title === 'วิธีเลือกคอนโดใกล้ BTS', 'H1 แรกเป็นชื่อบทความ');
  assert(o.keyword === 'คอนโดใกล้ BTS', 'Keyword: อ่านเป็น keyword');
  assert(o.items.length === 4, `หัวข้อ 4 ข้อ (ได้ ${o.items.length})`);
  assert(o.items[0].text === '1. ทำไมคอนโดใกล้ BTS ถึงน่าสนใจ' && o.items[0].level === 2, 'หัวข้อคงเลขนำหน้าตามต้นฉบับ');
  assert(o.items[1].level === 3, 'H3 คงระดับ');
  assert(o.items[0].notes === '- ประหยัดเวลา\n- ปล่อยเช่าง่าย', 'list ใต้หัวข้อเป็นแนวเนื้อหา');
  assert(o.notes === 'บทนำเล่าปัญหาการเดินทาง', 'ข้อความก่อนหัวข้อแรกเป็นแนวบทนำ');
  assert(outlineHasFaq(o.items), 'outline มี FAQ ของตัวเอง');
}
{
  // วางข้อความ: "H2: ..." / "[H3] ..." / "## ..." / ไม่ใช่ "H2O"
  const html = importFromText(['Title: รีวิวน้ำแร่', 'H2: น้ำแร่คืออะไร', 'อธิบายสั้น ๆ', '[H3] H2O กับแร่ธาตุ', 'H2O ไม่ใช่หัวข้อ', '## เลือกซื้อยังไง'].join('\n')).html;
  const o = parseOutlineFromHtml(html);
  assert(o.title === 'รีวิวน้ำแร่', 'Title: เป็นชื่อบทความ');
  assert(o.items.map((i) => `${i.level}:${i.text}`).join('|') === '2:น้ำแร่คืออะไร|3:H2O กับแร่ธาตุ|2:เลือกซื้อยังไง', `อ่านหัวข้อจากป้ายได้ (${o.items.map((i) => `${i.level}:${i.text}`).join('|')})`);
  assert((o.items[1].notes ?? '').includes('H2O ไม่ใช่หัวข้อ'), '"H2O" ไม่ถูกนับเป็นหัวข้อ');
}
{
  // ตาราง: แถว H2 | ข้อความ
  const html = '<table><tr><td>H2</td><td>ราคาเท่าไร</td></tr><tr><td>Main Keyword</td><td>ราคา x</td></tr><tr><td>หมายเหตุ</td><td>อะไรก็ได้</td></tr></table>';
  const o = parseOutlineFromHtml(html);
  assert(o.items.length === 1 && o.items[0].text === 'ราคาเท่าไร', 'แถวตาราง H2 เป็นหัวข้อ');
  assert(o.keyword === 'ราคา x', 'แถว Main Keyword เป็น keyword');
}
{
  // แบบฟอร์มบรีฟจริง (Outline_15 .docx): หัวตาราง Keyword | Search Volume, แถว Main KW, หัวข้อ "H2: ..." ในแท็ก h2, ลิงก์ใน list
  const html = '<table><tr><th></th><th><p>Keyword</p></th><th><p>Search Volume</p></th></tr><tr><th><p>Main KW</p></th><th><p>ตรวจคัดกรองมะเร็ง</p></th><th><p>500</p></th></tr><tr><th><p>Slug</p></th><th></th></tr></table>'
    + '<h1><a></a>H1: โปรแกรมตรวจคัดกรองมะเร็ง ราคาเท่าไหร่ </h1><h2><a></a>H2: FAQs</h2><h3><a></a>H3: ตรวจเลือดรู้ได้ไหม?</h3>'
    + '<ul><li><a href="https://x.test/a">แหล่งข้อมูล</a></li></ul>';
  const o = parseOutlineFromHtml(html);
  assert(o.keyword === 'ตรวจคัดกรองมะเร็ง', `Main KW ชนะหัวคอลัมน์ (ได้ ${o.keyword})`);
  assert(o.title === 'โปรแกรมตรวจคัดกรองมะเร็ง ราคาเท่าไหร่' && o.items.length === 2 && o.items[1].text === 'ตรวจเลือดรู้ได้ไหม?', 'ป้าย H1:/H2:/H3: ในแท็กหัวข้อถูกตัด');
  assert(o.items[1].notes === '- แหล่งข้อมูล (https://x.test/a)', `ลิงก์ใน list เป็นข้อความ + URL (ได้ ${o.items[1].notes})`);
  assert(outlineHasFaq(o.items), '"FAQs" นับเป็นส่วน FAQ');
}
{
  const o = parseOutlineFromHtml('<h1>A</h1><h1>B</h1><h2>C</h2>');
  assert(o.title === 'A' && o.items[0].level === 2 && o.items[0].text === 'B', 'H1 ที่สองลดเป็น H2');
}

console.log('stripMasterOutlineSection');
{
  const master = `# Master\nกฎ 1\n\n${OUTLINE_HEADING}\n\nลำดับหัวข้อ...\n1. H2 [x]\n\nกติกาการใช้โครงนี้:\n- เรียงส่วนต่าง ๆ ตามลำดับนี้`;
  const out = stripMasterOutlineSection(master);
  assert(out === '# Master\nกฎ 1', 'ตัดส่วน outline ท้าย Master Prompt');
  const mid = `กฎ 1\n\n${OUTLINE_HEADING}\nโครง\n\n## น้ำเสียง\nเป็นกันเอง`;
  assert(stripMasterOutlineSection(mid) === 'กฎ 1\n\n## น้ำเสียง\nเป็นกันเอง', 'ส่วนหลัง outline คงไว้');
  assert(stripMasterOutlineSection('ไม่มี outline') === 'ไม่มี outline', 'ไม่มีส่วน outline = เท่าเดิม');
  const json = JSON.stringify({ tone: 'x', structure: `กฎ\n\n${OUTLINE_HEADING}\nโครง` });
  const parsed = JSON.parse(stripMasterOutlineSection(json));
  assert(parsed.tone === 'x' && parsed.structure === 'กฎ', 'Master Prompt แบบ JSON ตัดในค่า string');
}

console.log('outlineWriterBlock');
{
  const block = outlineWriterBlock({ items: [{ level: 2, text: 'A', notes: 'n1' }, { level: 3, text: 'B' }] });
  assert(block.includes('1. <h2>A</h2>') && block.includes('  2. <h3>B</h3>'), 'แสดงหัวข้อพร้อมแท็กระดับ');
  assert(block.includes('แนวเนื้อหา: n1'), 'แนวเนื้อหาติดใต้หัวข้อ');
}

console.log('checkOutline');
const items = [
  { level: 2, text: 'ทำไมคอนโดใกล้ BTS ถึงน่าสนใจ' },
  { level: 3, text: 'ข้อดีด้านการเดินทาง' },
  { level: 2, text: 'วิธีเลือกทำเล' },
  { level: 2, text: 'สรุป' },
];
{
  const html = '<p>intro</p><h2>สรุปประเด็นสำคัญ</h2><ul><li>x</li></ul><h2>ทำไมคอนโดใกล้ BTS ถึงน่าสนใจ</h2><p>a</p><h3>ข้อดีด้านการเดินทาง</h3><p>b</p><h2>หัวข้อเสริม</h2><p>c</p><h2>วิธีเลือกทำเล</h2><p>d</p><h2>สรุป</h2><p>e</p><h2>คำถามที่พบบ่อย</h2>';
  const c = checkOutline(html, items);
  assert(c.missing.length === 0 && c.outOfOrder.length === 0 && c.renamed.length === 0, 'หัวข้อครบ + หัวข้อเสริมแทรกได้');
}
{
  const html = '<h2>ทำไมคอนโดใกล้ BTS จึงน่าสนใจ</h2><p>a</p><h2>ข้อดีด้านการเดินทาง</h2><p>b</p><h2>วิธีเลือกทำเล</h2><h2>สรุป</h2>';
  const c = checkOutline(html, items, { fix: true });
  assert(c.renamed.length === 2 && c.missing.length === 0, 'ชื่อเพี้ยน + ระดับผิด จับได้');
  assert(c.html.includes('<h2>ทำไมคอนโดใกล้ BTS ถึงน่าสนใจ</h2>') && c.html.includes('<h3>ข้อดีด้านการเดินทาง</h3>'), 'แก้ข้อความ/ระดับกลับตาม outline');
  assert(checkOutline(c.html, items).renamed.length === 0, 'หลังแก้ตรวจซ้ำผ่าน');
}
{
  const html = '<h2>วิธีเลือกทำเล</h2><h2>ทำไมคอนโดใกล้ BTS ถึงน่าสนใจ</h2><h3>ข้อดีด้านการเดินทาง</h3><h2>สรุป</h2>';
  const c = checkOutline(html, items);
  assert(c.outOfOrder.length === 1 && items[c.outOfOrder[0]].text === 'วิธีเลือกทำเล', 'หัวข้อสลับลำดับจับได้');
  assert(outlineWarnings(c, items)[0].includes('ผิดลำดับ'), 'คำเตือนผิดลำดับ');
}
{
  const html = '<p>intro</p><h2>ทำไมคอนโดใกล้ BTS ถึงน่าสนใจ</h2><p>a</p><h2>สรุป</h2><p>e</p><h2>คำถามที่พบบ่อย</h2><h3>q</h3>';
  const c = checkOutline(html, items);
  assert(c.missing.join(',') === '1,2', `ขาดหัวข้อ 2 ข้อ (ได้ ${c.missing.join(',')})`);
  const fill = '```html\n<h3>ข้อดีด้านการเดินทาง</h3><p>B</p><h2>วิธีเลือกทำเลที่ดี</h2><p>D</p>\n```';
  const sections = splitOutlineFill(fill, items, c.missing);
  assert(sections.size === 2 && sections.get(2)!.startsWith('<h2>วิธีเลือกทำเล</h2>'), 'ตัดคำตอบรอบเติมเป็นส่วน + แก้หัวข้อให้ตรง');
  const merged = insertOutlineSections(html, items, sections);
  const after = checkOutline(merged, items);
  assert(after.missing.length === 0 && after.outOfOrder.length === 0, 'แทรกส่วนที่ขาดแล้วครบ + ลำดับถูก');
  assert(merged.indexOf('<h2>วิธีเลือกทำเล</h2>') < merged.indexOf('<h2>สรุป</h2>'), 'ส่วนที่เติมอยู่ก่อนหัวข้อ outline ถัดไป');
}
{
  // ข้อสุดท้ายขาด — วางก่อน FAQ ที่ AI เพิ่ม ไม่ใช่ท้าย FAQ
  const html = '<h2>ทำไมคอนโดใกล้ BTS ถึงน่าสนใจ</h2><h3>ข้อดีด้านการเดินทาง</h3><h2>วิธีเลือกทำเล</h2><p>d</p><h2>คำถามที่พบบ่อย</h2><h3>q</h3>';
  const c = checkOutline(html, items);
  const merged = insertOutlineSections(html, items, splitOutlineFill('<h2>สรุป</h2><p>E</p>', items, c.missing));
  assert(merged.indexOf('<h2>สรุป</h2>') < merged.indexOf('<h2>คำถามที่พบบ่อย</h2>'), 'ข้อสุดท้ายแทรกก่อนหัวข้อเสริมถัดไป');
}
{
  // เลขนำหน้า/entity ไม่ทำให้ตรงผิด
  const html = '<h2>Q&amp;A ทั่วไป</h2>';
  const c = checkOutline(html, [{ level: 2, text: 'Q&A ทั่วไป' }]);
  assert(c.missing.length === 0 && c.renamed.length === 0, 'entity ถอดก่อนเทียบ');
}

console.log(`\n${passed} passed`);
