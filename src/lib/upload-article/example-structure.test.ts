/**
 * วัดโครงบทความตัวอย่างแบบตายตัว + ข้อความ outline ที่ต่อท้าย Master Prompt
 * Run: npx tsx src/lib/upload-article/example-structure.test.ts
 */
import {
  OUTLINE_HEADING,
  analyzeExampleStructure,
  buildOutlineSection,
  formatStructureEvidence,
  renderStructuredText,
} from './example-structure';
import { extractArticleText } from './master-prompt-ai';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

const P = (n: number) => `<p>${'ก'.repeat(n)}</p>`;

const HTML = `
<script>var x = "<h2>fake</h2>";</script><style>h2{color:red}</style><!-- <h2>comment</h2> -->
<h1>หัวเรื่องหลัก</h1>
${P(100)}${P(50)}
<div class="ez-toc-container"><p class="ez-toc-title">สารบัญ</p><ul><li><a href="#a">ข้อหนึ่ง</a></li><li><a href="#b">ข้อสอง</a></li><li><a href="#c">ข้อสาม</a></li></ul></div>
<h2>ข้อหนึ่ง</h2>
${P(200)}
<ul><li>หนึ่ง</li><li>สอง</li><li>สาม</li></ul>
<h2>ข้อสอง</h2>
${P(300)}
<h3>ย่อยหนึ่ง</h3>
${P(80)}
<table><tr><th>ก</th><th>ข</th></tr><tr><td>1</td><td>2</td></tr></table>
<img src="https://x/a.jpg" alt="รูปทดสอบ" width="800" height="600">
<h2>คำถามที่พบบ่อย</h2>
<h3>คำถามหนึ่ง?</h3>${P(40)}
<h3>คำถามสอง?</h3>${P(40)}
<h2>สรุป</h2>
${P(120)}
<div class="cta-box"><a href="/contact">ติดต่อเรา</a></div>
`;

console.log('analyzeExampleStructure');
const st = analyzeExampleStructure(HTML);
assert(st !== null, 'มีเนื้อหา → ได้ผลวัด');
if (!st) throw new Error('unreachable');
assert(st.h1 === 'หัวเรื่องหลัก', 'อ่าน H1');
assert(st.sections.map((s) => `${s.level}:${s.heading}`).join('|') === '2:ข้อหนึ่ง|2:ข้อสอง|3:ย่อยหนึ่ง|2:คำถามที่พบบ่อย|3:คำถามหนึ่ง?|3:คำถามสอง?|2:สรุป', 'ลำดับ H2/H3 ตามเอกสาร และไม่นับ h2 ใน script/style/comment');
assert(st.totals.h2 === 4 && st.totals.h3 === 3, 'นับ H2=4 H3=3');
assert(st.intro.chars === 150 && st.intro.paragraphs === 2, 'อินโทรก่อน H2 แรก 150 ตัวอักษร 2 ย่อหน้า (ไม่รวมสารบัญ)');
assert(st.sections[0].chars === 200 + 'หนึ่งสองสาม'.length, 'ความยาวส่วนแรก = ย่อหน้า + รายการ');
assert(st.sections[0].lists === 1 && st.sections[0].listItems === 3, 'ส่วนแรกมี list 1 ชุด 3 ข้อ');
assert(st.sections[1].chars === 300 && st.sections[1].charsWithSubs === 300 + 80 + 'ก1ข2'.length + 0, 'H2 รวมหัวข้อย่อย (ย่อหน้า+ตาราง)');
assert(st.sections[2].tables === 1 && st.sections[2].images === 1, 'H3 มีตาราง 1 รูป 1');
assert(st.totals.tables === 1 && st.totals.lists === 1 && st.totals.images === 1, 'รวม list/ตาราง/รูป');
assert(st.toc.found === true, 'ตรวจพบสารบัญ');
assert(!st.sections.some((s) => /ข้อสาม/.test(s.heading)) && st.intro.chars === 150, 'ข้อความในสารบัญไม่ถูกนับ');
assert(st.faq.found && st.faq.sectionIndex === 3 && st.faq.questions === 2, 'FAQ พบ 2 คำถาม');
assert(st.sections[3].role === 'faq' && st.sections[6].role === 'conclusion', 'role FAQ / สรุป');
assert(st.cta.found === true, 'ตรวจพบ CTA');
assert(st.totals.paragraphs === 9, 'นับย่อหน้ารวม (รวมข้อความในกล่อง CTA)');

console.log('empty input');
assert(analyzeExampleStructure('') === null, 'ว่าง → null');
assert(analyzeExampleStructure('<script>x</script><!-- a -->  ') === null, 'มีแต่ script/comment → null');

console.log('renderStructuredText');
const md = renderStructuredText('<h2>หัว</h2><p>ย่อหน้า</p><ul><li>ก</li><li>ข</li></ul><ol><li>หนึ่ง</li><li>สอง</li></ol><table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table><blockquote>อ้างอิง</blockquote><p><img src="x.jpg" alt="แมว" width="500"></p>');
assert(md.includes('## หัว'), 'heading marker');
assert(md.includes('- ก\n- ข'), 'ul → "- "');
assert(md.includes('1. หนึ่ง\n2. สอง'), 'ol → "1. "');
assert(md.includes('| a | b |\n| 1 | 2 |'), 'table → | a | b |');
assert(md.includes('> อ้างอิง'), 'blockquote → "> "');
assert(md.includes('[รูป: แมว]'), 'img → [รูป: alt]');
assert(md.includes('หัว\n\nย่อหน้า'), 'เว้นบรรทัดระหว่างบล็อก');

console.log('extractArticleText');
const art = extractArticleText('<html><body><nav>เมนู</nav><article><h2>หัว</h2><p>ก</p><ul><li>ข</li></ul></article><footer>ท้าย</footer></body></html>');
assert(art.includes('## หัว') && art.includes('- ข') && !art.includes('เมนู') && !art.includes('ท้าย'), 'คง marker และตัด nav/footer');
const long = extractArticleText(`<article>${P(20000)}</article>`);
assert(long.length <= 15_000, 'ข้อความที่ส่ง AI ตัดที่ 15,000');
assert(analyzeExampleStructure(`<article>${P(20000)}</article>`)?.totals.chars === 20000, 'แต่การวัดใช้บทความเต็ม');

console.log('formatters');
const ev = formatStructureEvidence([{ label: 'ตัวอย่างที่ 1', structure: st }]);
assert(ev.includes('[ตัวอย่างที่ 1]') && ev.includes('H2 4') && ev.includes('ห้ามนับ'), 'หลักฐานสำหรับ AI');
const one = buildOutlineSection([{ label: 'ตัวอย่างที่ 1', structure: st }]);
assert(one.startsWith('## โครงสร้าง Outline จากบทความตัวอย่าง') && one.startsWith(OUTLINE_HEADING), 'หัวข้อตรงตามกำหนด');
assert(!one.includes('ข้อหนึ่ง') && one.includes('H2') && one.includes('ห้ามคัดลอกข้อเท็จจริง'), 'ไม่ใส่ชื่อหัวข้อของตัวอย่าง + มีกติกาห้ามคัดลอก');
const many = buildOutlineSection([
  { label: 'ตัวอย่างที่ 1', structure: st },
  { label: 'ตัวอย่างที่ 2', structure: analyzeExampleStructure('<h2>ก</h2><p>ขขข</p>')! },
]);
assert(many.includes('ตัวอย่างที่ 2:') && many.includes('ช่วงที่เจอร่วมกัน') && many.includes('จำนวน H2: 1-4'), 'หลายตัวอย่าง: outline แต่ละชิ้น + ช่วงร่วม');
assert(buildOutlineSection([]) === '', 'ไม่มีผลวัด → ไม่ต่อท้าย');

// ส่วนอ้างอิง: <p>อ้างอิง</p> + list และแบบ heading
const refsPlain = analyzeExampleStructure(
  '<h2>หัวข้อ</h2><p>' + 'เนื้อหา'.repeat(20) + '</p><h2>คำถามที่พบบ่อย</h2><h3>ถามอะไร</h3><p>ตอบ</p><p>อ้างอิง</p><ul><li><a href="https://a.test/1">หนึ่ง</a></li><li><a href="https://a.test/2">สอง</a></li></ul>',
)!
assert(refsPlain.references.found && refsPlain.references.items === 2, 'อ้างอิงแบบข้อความเจอ 2 แหล่ง')
assert(refsPlain.references.afterFaq, 'อ้างอิงอยู่หลัง FAQ')
assert(refsPlain.totals.paragraphs === 2, 'ป้ายอ้างอิงไม่นับเป็นย่อหน้า')
assert(refsPlain.totals.lists === 0, 'list อ้างอิงไม่นับเป็น list ของเนื้อหา')
const refsHeading = analyzeExampleStructure('<h2>หัวข้อ</h2><p>' + 'เนื้อหา'.repeat(20) + '</p><h2>แหล่งอ้างอิง</h2><ul><li>ก</li><li>ข</li><li>ค</li></ul>')!
assert(refsHeading.references.found && refsHeading.references.items === 3, 'อ้างอิงแบบ heading เจอ 3 แหล่ง')
assert(refsHeading.sections[1].role === 'references', 'หัวข้ออ้างอิงมี role references')
const refsNone = analyzeExampleStructure('<h2>หัวข้อ</h2><p>บทความนี้อ้างอิงจากประสบการณ์จริงของทีมงาน</p>')!
assert(!refsNone.references.found, 'คำว่าอ้างอิงกลางประโยคไม่นับ')
const refsLine = buildOutlineSection([{ label: 'x', structure: refsPlain }])
assert(refsLine.includes('มีส่วนอ้างอิงท้ายบทความ 2 แหล่ง อยู่หลัง FAQ'), 'outline บอกส่วนอ้างอิง')
assert(refsLine.includes('ห้ามแต่งแหล่งเอง'), 'outline ห้ามแต่งแหล่ง')
assert(refsLine.includes('ห้ามใส่เลขกำกับอ้างอิง'), 'ตัวอย่างไม่มีเลขกำกับ = ห้ามใส่')
const refsNumbered = analyzeExampleStructure('<h2>หัวข้อ</h2><p>งานวิจัยพบผลนี้ [1] ' + 'เนื้อหา'.repeat(20) + '</p><p>อ้างอิง</p><ul><li>ก</li></ul>')!
assert(refsNumbered.references.inlineNumbers, 'เจอเลข [1] ในเนื้อหา')
assert(!buildOutlineSection([{ label: 'x', structure: refsNumbered }]).includes('ห้ามใส่เลขกำกับอ้างอิง'), 'ตัวอย่างใช้เลขกำกับ = ไม่ห้าม')
const refsSup = analyzeExampleStructure('<h2>หัวข้อ</h2><p>งานวิจัยพบผลนี้<sup><a href="#r1">1</a></sup> ' + 'เนื้อหา'.repeat(20) + '</p><p>อ้างอิง</p><ul><li>ก</li></ul>')!
assert(refsSup.references.inlineNumbers, 'เจอเลขตัวยกในเนื้อหา')
assert(!buildOutlineSection([{ label: 'x', structure: refsNone }]).includes('มีส่วนอ้างอิง'), 'ไม่มีอ้างอิง = ไม่มีบรรทัดนี้')

// บล็อกบทความที่เกี่ยวข้องของธีมไม่นับเป็นโครงบทความ
const withRelated = analyzeExampleStructure('<h2>หัวข้อ</h2><p>' + 'เนื้อหา'.repeat(20) + '</p><section><h2 class="r"><span>บทความที่เกี่ยวข้อง</span></h2><div><img src="a.jpg" width="300" height="200"><p>ลิงก์</p></div></section>')!
assert(withRelated.totals.h2 === 1, 'ตัด H2 บทความที่เกี่ยวข้อง')
assert(withRelated.totals.images === 0, 'รูปในบล็อกที่เกี่ยวข้องไม่นับ')
assert(!renderStructuredText('<h2>ก</h2><p>ข</p><h2>Related posts</h2><p>ค</p>').includes('ค'), 'ข้อความส่ง AI ตัดบล็อกที่เกี่ยวข้อง')
assert(analyzeExampleStructure('<h2>บทความที่เกี่ยวข้องกับสุขภาพเข่า</h2><p>' + 'เนื้อหา'.repeat(20) + '</p>')!.totals.h2 === 1, 'หัวข้อที่แค่ขึ้นต้นเหมือนกันไม่ถูกตัด')

console.log(`\n${passed} checks passed`);
